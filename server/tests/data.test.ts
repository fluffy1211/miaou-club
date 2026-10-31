import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { createAuth } from "../src/infrastructure/auth/auth.js";
import * as schema from "../src/infrastructure/db/schema.js";
import { accountsHTTP } from "../src/accounts/http.js";
import { encountersHTTP } from "../src/encounters/http.js";
import { Encounters } from "../src/encounters/service.js";
import type { ObjectStorage } from "../src/encounters/storage.js";
import { DataManagement } from "../src/data/service.js";
import { dataHTTP } from "../src/data/http.js";
import { csv, zip } from "../src/data/archive.js";
const origin = "http://localhost:43991";
const databaseURL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test";
if (!new URL(databaseURL).pathname.endsWith("_test"))
  throw new Error("Dedicated test DB required");
class StorageDouble implements ObjectStorage {
  objects = new Map<string, Buffer>();
  failPutSuffix = "";
  failDelete = false;
  async put(key: string, bytes: Buffer) {
    if (this.failPutSuffix && key.endsWith(this.failPutSuffix))
      throw new Error("Synthetic failure");
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("Synthetic missing object");
    return bytes;
  }
  async remove(keys: string[]) {
    if (this.failDelete) throw new Error("Synthetic failure");
    for (const k of keys) this.objects.delete(k);
  }
}
const photo = () =>
  sharp({
    create: { width: 160, height: 80, channels: 3, background: "#bcdccb" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
const input = (mediaId: string) => ({
  mediaId,
  title: "Un museau synthétique",
  description: "Une rencontre de test",
  encounterDate: "2026-10-03",
  visibility: "public",
});
async function isolated(
  run: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const admin = createDatabase(databaseURL);
  const name = "photos_" + randomUUID().replaceAll("-", "") + "_test";
  await admin.pool.query(`create database "${name}"`);
  const url = new URL(databaseURL);
  url.pathname = name;
  const h = await setup(url.href);
  try {
    await run(h);
  } finally {
    await closePool(h.pool);
    await admin.pool.query(`drop database "${name}" with(force)`);
    await closePool(admin.pool);
  }
}
async function setup(url: string) {
  const { pool, db } = createDatabase(url);
  await migrate(db, { migrationsFolder: "server/drizzle" });
  const auth = createAuth(
    db,
    {
      secret: "synthetic-media-test-secret-at-least-32-characters",
      baseURL: origin,
      termsVersion: "synthetic-terms-v1",
    },
    schema,
  );
  const storage = new StorageDouble();
  const service = new Encounters(pool, storage);
  const data = new DataManagement(pool, storage);
  async function member(email: string) {
    await pool.query("insert into admission(email) values($1)", [email]);
    const response = await accountsHTTP(
      new Request(origin + "/api/auth/sign-up/email", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "synthetic-password-long",
          name: "m_" + email.split("@")[0].replace(/[^a-z0-9_]/g, "_"),
          acceptedTerms: true,
        }),
      }),
      db,
      auth,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    const cookies = response.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    return { id: body.user.id as string, cookies };
  }
  async function call(
    cookies: string,
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    key?: string,
  ) {
    return (
      (await dataHTTP(
        new Request(origin + path, {
          method,
          headers: {
            cookie: cookies,
            origin,
            "content-type": "application/json",
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        db,
        auth,
        data,
      )) ??
      (await encountersHTTP(
        new Request(origin + path, {
          method,
          headers: {
            cookie: cookies,
            origin,
            "content-type": "application/json",
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        db,
        auth,
        service,
      ))!
    );
  }
  async function upload(cookies: string, bytes?: Buffer) {
    return (await encountersHTTP(
      new Request(origin + "/api/v1/media", {
        method: "POST",
        headers: {
          cookie: cookies,
          origin,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(bytes ?? (await photo())),
      }),
      db,
      auth,
      service,
    ))!;
  }
  async function ready(cookies: string) {
    const r = await upload(cookies);
    assert.equal(r.status, 201);
    const { media } = await r.json();
    assert.equal(media.state, "ready");
    return media.id as string;
  }
  async function publish(
    cookies: string,
    id: string,
    visibility = "public",
    key = randomUUID(),
  ) {
    const r = await call(
      cookies,
      "/api/v1/encounters",
      { ...input(id), visibility },
      "POST",
      key,
    );
    assert.equal(r.status, 201);
    return (await r.json()).encounter;
  }
  return {
    pool,
    db,
    auth,
    storage,
    service,
    data,
    member,
    call,
    upload,
    ready,
    publish,
  };
}
async function admin(h: Awaited<ReturnType<typeof setup>>, id: string) {
  await h.pool.query("update user_policy set role='admin' where user_id=$1", [
    id,
  ]);
  await h.pool.query('update "user" set two_factor_enabled=true where id=$1', [
    id,
  ]);
  await h.pool.query(
    "update session_security set mfa_at=now(),admin_used_at=now() where session_id in(select id from session where user_id=$1)",
    [id],
  );
}
function unzip(buffer: Buffer) {
  const result = new Map<string, Buffer>();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18),
      nameSize = buffer.readUInt16LE(at + 26),
      extra = buffer.readUInt16LE(at + 28),
      name = buffer.subarray(at + 30, at + 30 + nameSize).toString();
    const start = at + 30 + nameSize + extra;
    result.set(name, buffer.subarray(start, start + size));
    at = start + size;
  }
  return result;
}
test("reports deduplicate concurrent requests, never auto-hide and audit private consultation only in an open report under session MFA", () =>
  isolated(async (h) => {
    const a = await h.member("author@example.test"),
      b = await h.member("reporter@example.test"),
      c = await h.member("admin@example.test");
    const entry = await h.publish(a.cookies, await h.ready(a.cookies));
    assert.equal(
      (
        await h.call("", `/api/v1/encounters/${entry.id}/report`, {
          reason: "test",
        })
      ).status,
      401,
    );
    const requests = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.call(b.cookies, `/api/v1/encounters/${entry.id}/report`, {
          reason: "Motif synthétique",
        }),
      ),
    );
    for (const r of requests) assert.equal(r.status, 201);
    const id = (await requests[0].json()).id;
    assert.equal(
      (await h.pool.query("select count(*)::int n from report")).rows[0].n,
      1,
    );
    assert.equal(
      (await h.call(b.cookies, "/api/v1/encounters/" + entry.id)).status,
      200,
    );
    assert.equal(
      (await h.call(c.cookies, "/api/v1/admin/reports")).status,
      403,
    );
    await admin(h, c.id);
    assert.equal(
      (await h.call(c.cookies, `/api/v1/admin/reports/${id}/consult`, {}))
        .status,
      400,
    );
    const edit = await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      {
        title: entry.title,
        description: entry.description,
        encounterDate: entry.encounterDate,
        visibility: "private",
        revision: 1,
      },
      "PATCH",
    );
    assert.equal(edit.status, 200);
    assert.equal(
      (await h.call(c.cookies, "/api/v1/encounters/" + entry.id)).status,
      404,
    );
    assert.equal((await h.call(c.cookies, entry.image)).status, 404);
    const consult = await h.call(
      c.cookies,
      `/api/v1/admin/reports/${id}/consult`,
      { reason: "Traitement du dossier" },
    );
    assert.equal(consult.status, 200);
    const privateEntry = (await consult.json()).encounter;
    assert.equal(privateEntry.title, entry.title);
    assert.equal((await h.call(c.cookies, privateEntry.image)).status, 200);
    assert.equal((await h.call(b.cookies, privateEntry.image)).status, 403);
    assert.equal(
      (
        await h.call(c.cookies, `/api/v1/admin/reports/${id}/action`, {
          action: "hide",
          reason: "Motif de masquage",
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.call(a.cookies, "/api/v1/encounters/" + entry.id)).status,
      200,
    );
    assert.equal(
      (
        await h.pool.query(
          "select count(*)::int n from moderation_audit where action in ('report_consulted','report_image_consulted')",
        )
      ).rows[0].n,
      2,
    );
    await h.call(c.cookies, `/api/v1/admin/reports/${id}/action`, {
      action: "close",
      reason: "Dossier traité",
    });
    assert.equal((await h.call(c.cookies, privateEntry.image)).status, 404);
    assert.equal(
      (
        await h.call(c.cookies, `/api/v1/admin/reports/${id}/action`, {
          action: "restore",
          reason: "Révision de décision",
        })
      ).status,
      200,
    );
    const unreported = await h.publish(
      a.cookies,
      await h.ready(a.cookies),
      "private",
    );
    assert.equal(
      (await h.call(c.cookies, "/api/v1/encounters/" + unreported.id)).status,
      404,
    );
  }));
test("suspension revokes feeds/maps/photos, preserves owner rights and reactivation keeps individual masking", () =>
  isolated(async (h) => {
    const a = await h.member("owner@example.test"),
      b = await h.member("reader@example.test"),
      c = await h.member("moderator@example.test");
    await admin(h, c.id);
    const entry = await h.publish(a.cookies, await h.ready(a.cookies));
    const r = await h.call(b.cookies, `/api/v1/encounters/${entry.id}/report`, {
      reason: "Test",
    });
    const reportId = (await r.json()).id;
    await h.call(c.cookies, `/api/v1/admin/reports/${reportId}/action`, {
      action: "hide",
      reason: "Masquage synthétique",
    });
    assert.equal(
      (
        await h.call(c.cookies, "/api/v1/admin/members/" + a.id, {
          action: "suspend",
          reason: "Suspension synthétique",
        })
      ).status,
      200,
    );
    assert.equal((await h.call(b.cookies, entry.image)).status, 404);
    assert.equal((await h.call(a.cookies, entry.image)).status, 200);
    assert.equal(
      (await h.call(a.cookies, "/api/v1/me/export", {})).status,
      202,
    );
    await h.call(c.cookies, "/api/v1/admin/members/" + a.id, {
      action: "reactivate",
      reason: "Réactivation synthétique",
    });
    assert.equal((await h.call(b.cookies, entry.image)).status, 404);
    assert.equal(
      (await h.call(a.cookies, "/api/v1/encounters/" + entry.id)).status,
      200,
    );
    await h.call(c.cookies, `/api/v1/admin/reports/${reportId}/action`, {
      action: "restore",
      reason: "Rétablissement synthétique",
    });
    assert.equal((await h.call(b.cookies, entry.image)).status, 200);
  }));
test("ZIP export includes private processed photos and safe structured data, rejects strangers/stale proof, expires and resumes after missing storage", () =>
  isolated(async (h) => {
    const a = await h.member("export@example.test"),
      b = await h.member("stranger@example.test");
    const entry = await h.publish(
      a.cookies,
      await h.ready(a.cookies),
      "private",
    );
    await h.pool.query(
      "update encounter set title='=1+1',description=$2 where id=$1",
      [entry.id, 'Été; "citation"\nligne'],
    );
    const request = await h.call(a.cookies, "/api/v1/me/export", {});
    assert.equal(request.status, 202);
    const id = (await request.json()).export.id;
    assert.equal(
      (await h.call(a.cookies, `/api/v1/me/exports/${id}/download`)).status,
      404,
    );
    const imageKey = entry.image.split("/")[2] + "/image.webp",
      image = h.storage.objects.get(imageKey)!;
    h.storage.objects.delete(imageKey);
    await h.data.maintenance();
    assert.equal(
      (
        await h.pool.query(
          "select state,attempts from data_export where id=$1",
          [id],
        )
      ).rows[0].attempts,
      1,
    );
    h.storage.objects.set(imageKey, image);
    await h.pool.query(
      "update data_export set next_attempt_at=now() where id=$1",
      [id],
    );
    await new DataManagement(h.pool, h.storage).maintenance();
    assert.equal(
      (await h.call(b.cookies, `/api/v1/me/exports/${id}/download`)).status,
      404,
    );
    const r = await h.call(a.cookies, `/api/v1/me/exports/${id}/download`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const bytes = Buffer.from(await r.arrayBuffer()),
      files = unzip(bytes),
      data = JSON.parse(files.get("data.json")!.toString());
    assert.equal(data.data.encounters[0].title, "=1+1");
    assert.ok(files.get("tables/encounters.csv")!.toString().includes("'=1+1"));
    assert.ok(files.has("photos/" + entry.image.split("/")[2] + "-image.webp"));
    assert.ok(!JSON.stringify(data).includes("synthetic-password-long"));
    assert.ok(!JSON.stringify(data).includes("fingerprint"));
    assert.ok(!JSON.stringify(data).includes("request_key"));
    await h.pool.query(
      "update session_security set reauthenticated_at=now()-interval '10 minutes' where session_id in(select id from session where user_id=$1)",
      [a.id],
    );
    assert.equal(
      (await h.call(a.cookies, `/api/v1/me/exports/${id}/download`)).status,
      403,
    );
    await h.pool.query(
      "update data_export set expires_at=now()-interval '1 second' where id=$1",
      [id],
    );
    await h.data.maintenance();
    assert.equal(
      (await h.pool.query("select id from data_export")).rowCount,
      0,
    );
  }));
test("account deletion immediately revokes all accesses, invalidates archives and survives failed object purge across restart", () =>
  isolated(async (h) => {
    const a = await h.member("delete@example.test"),
      b = await h.member("other@example.test");
    const entry = await h.publish(a.cookies, await h.ready(a.cookies));
    await h.call(a.cookies, "/api/v1/me/export", {});
    await h.data.maintenance();
    assert.equal(
      (await h.call(a.cookies, "/api/v1/me/deletion", {})).status,
      400,
    );
    const response = await h.call(a.cookies, "/api/v1/me/deletion", {
      confirmation: "SUPPRIMER",
    });
    assert.equal(response.status, 202);
    assert.equal((await h.call(a.cookies, entry.image)).status, 401);
    assert.equal((await h.call(b.cookies, entry.image)).status, 404);
    assert.equal(
      (
        await h.pool.query("select id from data_export where owner_id=$1", [
          a.id,
        ])
      ).rowCount,
      0,
    );
    h.storage.failDelete = true;
    await h.data.maintenance();
    assert.equal(
      (
        await h.pool.query(
          "select completed_at from account_deletion where owner_id=$1",
          [a.id],
        )
      ).rows[0].completed_at,
      null,
    );
    assert.equal(
      (await h.pool.query('select id from "user" where id=$1', [a.id]))
        .rowCount,
      1,
    );
    h.storage.failDelete = false;
    await h.pool.query(
      "update account_deletion set next_attempt_at=now() where owner_id=$1",
      [a.id],
    );
    await new DataManagement(h.pool, h.storage).maintenance();
    assert.equal(
      (await h.pool.query('select id from "user" where id=$1', [a.id]))
        .rowCount,
      0,
    );
    assert.equal(
      (await h.pool.query("select id from media where owner_id=$1", [a.id]))
        .rowCount,
      0,
    );
    assert.equal(h.storage.objects.size, 0);
    assert.equal(
      (
        await h.pool.query(
          "select owner_id from account_activity where owner_id=$1",
          [a.id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      h.pool.query("insert into account_activity(owner_id) values($1)", [a.id]),
      { code: "23503" },
    );
  }));
test("CSV formula neutralization handles whitespace, quotes, newlines and UTF-8; ZIP refuses unsafe paths", () => {
  assert.ok(csv([{ text: " \t=1+1", note: 'Été;"\n' }]).includes("' \t=1+1"));
  assert.throws(() => zip([{ name: "../escape", bytes: Buffer.from("x") }]));
});
test("report limits persist across service restart; private/unadmitted reporting and expired admin consultation are refused", () =>
  isolated(async (h) => {
    const a = await h.member("quota-author@example.test"),
      b = await h.member("quota-reader@example.test"),
      c = await h.member("quota-admin@example.test");
    await admin(h, c.id);
    let first = "";
    for (let n = 0; n < 6; n++) {
      const entry = await h.publish(a.cookies, await h.ready(a.cookies));
      const r = await h.call(
        b.cookies,
        `/api/v1/encounters/${entry.id}/report`,
        { reason: "Motif " + n },
      );
      assert.equal(r.status, n < 5 ? 201 : 429);
      if (n === 0) first = (await r.json()).id;
    }
    const grant = (
      await (
        await h.call(c.cookies, `/api/v1/admin/reports/${first}/consult`, {
          reason: "Examen",
        })
      ).json()
    ).encounter.image;
    await h.pool.query(
      "update report_consultation set expires_at=now()-interval '1 second'",
    );
    assert.equal((await h.call(c.cookies, grant)).status, 404);
    await h.pool.query(
      "update session_security set admin_used_at=now()-interval '16 minutes' where session_id in(select id from session where user_id=$1)",
      [c.id],
    );
    assert.equal(
      (await h.call(c.cookies, "/api/v1/admin/reports")).status,
      403,
    );
    const privateEntry = await h.publish(
      a.cookies,
      await h.ready(a.cookies),
      "private",
    );
    assert.equal(
      (
        await h.call(
          b.cookies,
          `/api/v1/encounters/${privateEntry.id}/report`,
          { reason: "Test" },
        )
      ).status,
      404,
    );
    await h.pool.query("update admission set active=false where email=$1", [
      "quota-reader@example.test",
    ]);
    assert.equal(
      (
        await h.call(
          b.cookies,
          `/api/v1/encounters/${privateEntry.id}/report`,
          { reason: "Test" },
        )
      ).status,
      403,
    );
  }));
test("lot 5 additive upgrade keeps real previous encounter/media/profile rows intact", async () => {
  const control = createDatabase(databaseURL),
    name = "upgrade_data_" + randomUUID().replaceAll("-", "") + "_test";
  await control.pool.query(`create database "${name}"`);
  const url = new URL(databaseURL);
  url.pathname = name;
  const { db, pool } = createDatabase(url.href);
  const { mkdtemp, readFile, writeFile, copyFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = await mkdtemp(join(tmpdir(), "miaou-data-upgrade-"));
  try {
    const journal = JSON.parse(
      await readFile("server/drizzle/meta/_journal.json", "utf8"),
    );
    const previous = { ...journal, entries: journal.entries.slice(0, 8) };
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(join(folder, "meta")),
    );
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify(previous),
    );
    for (const row of previous.entries)
      await copyFile(
        "server/drizzle/" + row.tag + ".sql",
        join(folder, row.tag + ".sql"),
      );
    await migrate(db, { migrationsFolder: folder });
    const owner = randomUUID(),
      media = randomUUID(),
      entry = randomUUID();
    await pool.query('insert into "user"(id,name,email) values($1,$2,$3)', [
      owner,
      "Été synthétique",
      "upgrade-data@example.test",
    ]);
    await pool.query(
      "insert into profile(user_id,display_name) values($1,$2)",
      [owner, "Nom conservé"],
    );
    await pool.query(
      "insert into media(id,owner_id,state,bytes,width,height,expires_at) values($1,$2,'ready',100,160,80,now()+interval '1 day')",
      [media, owner],
    );
    await pool.query(
      "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date) values($1,$2,$3,$4,'synthetic','Souvenir conservé','2026-10-06')",
      [entry, owner, media, randomUUID()],
    );
    await migrate(db, { migrationsFolder: "server/drizzle" });
    await migrate(db, { migrationsFolder: "server/drizzle" });
    assert.equal(
      (await pool.query("select title from encounter where id=$1", [entry]))
        .rows[0].title,
      "Souvenir conservé",
    );
    assert.equal(
      (
        await pool.query("select display_name from profile where user_id=$1", [
          owner,
        ])
      ).rows[0].display_name,
      "Nom conservé",
    );
    assert.equal(
      (await pool.query("select id from media where id=$1", [media])).rowCount,
      1,
    );
  } finally {
    await closePool(pool);
    await control.pool.query(`drop database "${name}"`);
    await closePool(control.pool);
    await rm(folder, { recursive: true, force: true });
  }
});
test("ZIP CRC and central directory are readable by an independent standard library", async () => {
  const { execFileSync } = await import("node:child_process");
  const bytes = zip([
    { name: "data.json", bytes: Buffer.from('{"accent":"Été"}') },
    { name: "photos/synthetic.webp", bytes: Buffer.from([0, 1, 2, 255]) },
  ]);
  const result = execFileSync(
    "python3",
    [
      "-c",
      'import io,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;assert z.read("data.json").decode("utf8")==\'{"accent":"Été"}\';assert z.read("photos/synthetic.webp")==bytes([0,1,2,255]);print("valid")',
    ],
    { input: bytes },
  );
  assert.equal(result.toString().trim(), "valid");
});

test("maintenance purges expired exports, consultations, closed reports and audit without deleting open dossiers or current traces", () =>
  isolated(async (h) => {
    const a = await h.member("retention@example.test");
    await h.pool.query(
      "insert into report(id,encounter_id,reporter_id,reason,created_at,closed_at) values('closed-old','synthetic',$1,'Motif',now()-interval '8 months',now()-interval '7 months'),('closed-current','synthetic',$1,'Motif',now(),now()),('open-old','synthetic',$1,'Motif',now()-interval '8 months',null)",
      [a.id],
    );
    await h.pool.query(
      "insert into moderation_audit(id,actor,target,action,reason,created_at) values('old',$1,'synthetic','hide','Motif',now()-interval '7 months'),('current',$1,'synthetic','hide','Motif',now())",
      [a.id],
    );
    await h.pool.query(
      "insert into report_consultation(id,report_id,session_id,actor,reason,expires_at) values('old','open-old','synthetic',$1,'Motif',now()-interval '1 minute'),('current','open-old','synthetic',$1,'Motif',now()+interval '5 minutes')",
      [a.id],
    );
    await h.pool.query(
      "insert into data_export(id,owner_id,state,expires_at) values('old',$1,'ready',now()-interval '1 second'),('current',$1,'ready',now()+interval '24 hours')",
      [a.id],
    );
    await h.pool.query(
      "insert into account_deletion(owner_id,completed_at) values('old',now()-interval '31 days'),('current',now())",
    );
    await h.data.maintenance();
    for (const table of [
      "moderation_audit",
      "report_consultation",
      "data_export",
    ]) {
      assert.deepEqual(
        (await h.pool.query(`select id from ${table} order by id`)).rows.map(
          (r) => r.id,
        ),
        ["current"],
      );
    }
    assert.deepEqual(
      (await h.pool.query("select id from report order by id")).rows.map(
        (r) => r.id,
      ),
      ["closed-current", "open-old"],
    );
    assert.deepEqual(
      (
        await h.pool.query(
          "select owner_id from account_deletion order by owner_id",
        )
      ).rows.map((r) => r.owner_id),
      ["current"],
    );
  }));

test("inactivity warning starts only at 24 months, is serialized across workers, and grants 30 full days before durable deletion", () =>
  isolated(async (h) => {
    const a = await h.member("inactive@example.test"),
      b = await h.member("recent@example.test");
    const entry = await h.publish(a.cookies, await h.ready(a.cookies));
    await h.pool.query(
      "update account_activity set last_used_at=now()-interval '25 months' where owner_id=$1",
      [a.id],
    );
    await h.pool.query(
      "update account_activity set last_used_at=now()-interval '23 months' where owner_id=$1",
      [b.id],
    );
    const sent: string[] = [];
    const sender = async (email: string, key: string) => {
      sent.push(email);
      assert.match(key, /^inactivity\/[a-f0-9]{64}$/);
    };
    await Promise.all([
      new DataManagement(h.pool, h.storage, sender).maintenance(),
      new DataManagement(h.pool, h.storage, sender).maintenance(),
    ]);
    assert.deepEqual(sent, ["inactive@example.test"]);
    assert.ok(
      (
        await h.pool.query(
          "select warned_at from account_activity where owner_id=$1",
          [a.id],
        )
      ).rows[0].warned_at,
    );
    await h.pool.query(
      "update account_activity set warned_at=now()-interval '29 days 23 hours' where owner_id=$1",
      [a.id],
    );
    await h.data.maintenance();
    assert.equal(
      (
        await h.pool.query(
          "select owner_id from account_deletion where owner_id=$1",
          [a.id],
        )
      ).rowCount,
      0,
    );
    await h.pool.query(
      "update account_activity set warned_at=now()-interval '30 days 1 second' where owner_id=$1",
      [a.id],
    );
    h.storage.failDelete = true;
    await h.data.maintenance();
    assert.equal((await h.call(a.cookies, entry.image)).status, 401);
    assert.equal(
      (
        await h.pool.query("select status from user_policy where user_id=$1", [
          a.id,
        ])
      ).rows[0].status,
      "deleting",
    );
    assert.equal(
      (
        await h.pool.query(
          "select completed_at from account_deletion where owner_id=$1",
          [a.id],
        )
      ).rows[0].completed_at,
      null,
    );
    h.storage.failDelete = false;
    await h.pool.query(
      "update account_deletion set next_attempt_at=now() where owner_id=$1",
      [a.id],
    );
    await new DataManagement(h.pool, h.storage).maintenance();
    assert.equal(
      (await h.pool.query('select id from "user" where id=$1', [a.id]))
        .rowCount,
      0,
    );
    assert.equal(
      (await h.pool.query('select id from "user" where id=$1', [b.id]))
        .rowCount,
      1,
    );
    assert.equal(h.storage.objects.size, 0);
  }));

test("failed or unconfigured inactivity mail cannot start deletion; retry survives restart and native login cancels warning", () =>
  isolated(async (h) => {
    const a = await h.member("warning-retry@example.test");
    await h.pool.query(
      "update account_activity set last_used_at=now()-interval '25 months' where owner_id=$1",
      [a.id],
    );
    await h.data.maintenance();
    let attempts = 0;
    const failed = new DataManagement(h.pool, h.storage, async () => {
      attempts++;
      throw new Error("Synthetic delivery failure");
    });
    await failed.maintenance();
    await failed.maintenance();
    assert.equal(attempts, 1);
    assert.equal(
      (
        await h.pool.query(
          "select warned_at from account_activity where owner_id=$1",
          [a.id],
        )
      ).rows[0].warned_at,
      null,
    );
    assert.equal(
      (
        await h.pool.query(
          "select owner_id from account_deletion where owner_id=$1",
          [a.id],
        )
      ).rowCount,
      0,
    );
    await h.pool.query(
      "update account_activity set next_warning_at=now() where owner_id=$1",
      [a.id],
    );
    await new DataManagement(h.pool, h.storage, async () => {
      attempts++;
    }).maintenance();
    assert.equal(attempts, 2);
    const login = await h.auth.handler(
      new Request(origin + "/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "warning-retry@example.test",
          password: "synthetic-password-long",
        }),
      }),
    );
    assert.equal(login.status, 200);
    const activity = (
      await h.pool.query("select * from account_activity where owner_id=$1", [
        a.id,
      ])
    ).rows[0];
    assert.equal(activity.warned_at, null);
    assert.ok(activity.last_used_at > new Date(Date.now() - 60000));
    await h.data.maintenance();
    assert.equal(
      (await h.pool.query('select id from "user" where id=$1', [a.id]))
        .rowCount,
      1,
    );
  }));

test("legacy activity starts conservatively and preserves existing warning deadlines", () =>
  isolated(async (h) => {
    const a = await h.member("backfill@example.test");
    await h.pool.query("delete from account_activity where owner_id=$1", [
      a.id,
    ]);
    await h.pool.query(
      "update \"user\" set created_at=now()-interval '26 months' where id=$1",
      [a.id],
    );
    await h.pool.query(
      "update session_security set used_at=now()-interval '25 months' where session_id in(select id from session where user_id=$1)",
      [a.id],
    );
    let count = 0;
    await new DataManagement(h.pool, h.storage, async () => {
      count++;
    }).maintenance();
    assert.equal(count, 0);
    assert.ok(
      (
        await h.pool.query(
          "select last_used_at from account_activity where owner_id=$1",
          [a.id],
        )
      ).rows[0].last_used_at > new Date(Date.now() - 60000),
    );
    await h.pool.query(
      "update account_activity set last_used_at=now()-interval '25 months' where owner_id=$1",
      [a.id],
    );
    await new DataManagement(h.pool, h.storage, async () => {
      count++;
    }).maintenance();
    assert.equal(count, 1);
    const before = (
      await h.pool.query(
        "select warned_at from account_activity where owner_id=$1",
        [a.id],
      )
    ).rows[0].warned_at;
    await new DataManagement(h.pool, h.storage, async () => {
      count++;
    }).maintenance();
    assert.equal(count, 1);
    assert.deepEqual(
      (
        await h.pool.query(
          "select warned_at from account_activity where owner_id=$1",
          [a.id],
        )
      ).rows[0].warned_at,
      before,
    );
  }));

test("inactivity mail adapter sends only the warning, uses idempotency and shared global budget, records failure safely", () =>
  isolated(async (h) => {
    const { inactivitySender } = await import("../src/accounts/mail.js");
    const original = globalThis.fetch;
    const payloads: { headers: Headers; body: Record<string, unknown> }[] = [];
    globalThis.fetch = async (_url, options) => {
      payloads.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body)),
      });
      return new Response("{}", { status: payloads.length === 1 ? 200 : 503 });
    };
    try {
      const send = inactivitySender(
        h.db,
        "synthetic-key",
        "synthetic@example.test",
        origin,
        "synthetic-secret",
      );
      await send("recipient@example.test", "synthetic-warning");
      await assert.rejects(send("recipient@example.test", "synthetic-warning"));
      assert.equal(
        payloads[0].headers.get("idempotency-key"),
        "synthetic-warning",
      );
      assert.equal(
        payloads[0].body.subject,
        "Ton compte Miaou Club est inactif",
      );
      assert.match(String(payloads[0].body.text), /30 jours/);
      assert.match(
        String(payloads[0].body.text),
        /http:\/\/localhost:43991\/donnees/,
      );
      assert.deepEqual(payloads[0].body, payloads[1].body);
      assert.deepEqual(
        (
          await h.pool.query(
            "select result from mail_attempt where type='inactivity_warning' order by created_at",
          )
        ).rows.map((r) => r.result),
        ["accepted", "failed"],
      );
      assert.equal(
        (await h.pool.query("select events from auth_limit")).rows[0].events
          .length,
        2,
      );
    } finally {
      globalThis.fetch = original;
    }
  }));

test("export snapshot survives a real encounter edit during generation without postponing the copy", () =>
  isolated(async (h) => {
    const a = await h.member("export-edit@example.test");
    const entry = await h.publish(
      a.cookies,
      await h.ready(a.cookies),
      "private",
    );
    const requested = await h.call(a.cookies, "/api/v1/me/export", {});
    const id = (await requested.json()).export.id;
    let edited = false;
    const sqlErrors: string[] = [];
    const pool = new Proxy(h.pool, {
      get(target, key) {
        if (key === "connect")
          return async () => {
            const c = await target.connect();
            return new Proxy(c, {
              get(client, property) {
                if (property === "query")
                  return async (sql: string, values: unknown[]) => {
                    if (
                      !edited &&
                      sql.startsWith("select handle,display_name")
                    ) {
                      edited = true;
                      const response = await h.call(
                        a.cookies,
                        "/api/v1/encounters/" + entry.id,
                        {
                          title: "Titre modifié pendant la copie",
                          description: entry.description,
                          encounterDate: entry.encounterDate,
                          visibility: "private",
                          revision: entry.revision,
                        },
                        "PATCH",
                      );
                      assert.equal(response.status, 200);
                    }
                    try {
                      return await client.query(sql, values);
                    } catch (e) {
                      sqlErrors.push((e as { code: string }).code);
                      throw e;
                    }
                  };
                const value = Reflect.get(client, property);
                return typeof value === "function" ? value.bind(client) : value;
              },
            });
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await new DataManagement(pool, h.storage).maintenance();
    assert.equal(edited, true);
    assert.deepEqual(sqlErrors, []);
    const job = (
      await h.pool.query(
        "select state,attempts,archive from data_export where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(job.state, "ready");
    assert.equal(job.attempts, 0);
    const data = JSON.parse(unzip(job.archive).get("data.json")!.toString());
    assert.equal(data.data.encounters[0].title, entry.title);
    assert.equal(
      (
        await h.pool.query("select title from encounter where id=$1", [
          entry.id,
        ])
      ).rows[0].title,
      "Titre modifié pendant la copie",
    );
  }));

for (const method of ["request", "sign-in"] as const) {
  test(`authenticated ${method} cancels inactivity after the overdue preflight read`, () =>
    isolated(async (h) => {
      const a = await h.member(`return-${method}@example.test`);
      await h.pool.query(
        "update account_activity set last_used_at=now()-interval '25 months',warned_at=now()-interval '31 days' where owner_id=$1",
        [a.id],
      );
      let returned = false;
      const pool = new Proxy(h.pool, {
        get(target, key) {
          if (key === "connect")
            return async () => {
              const c = await target.connect();
              return new Proxy(c, {
                get(client, property) {
                  if (property === "query")
                    return async (sql: string, values: unknown[]) => {
                      const result = await client.query(sql, values);
                      if (!returned && sql.startsWith("select a.*,u.email")) {
                        returned = true;
                        const response =
                          method === "request"
                            ? await h.call(a.cookies, "/api/v1/me/exports")
                            : await h.auth.handler(
                                new Request(
                                  origin + "/api/auth/sign-in/email",
                                  {
                                    method: "POST",
                                    headers: {
                                      origin,
                                      "content-type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      email: `return-${method}@example.test`,
                                      password: "synthetic-password-long",
                                    }),
                                  },
                                ),
                              );
                        assert.equal(response.status, 200);
                      }
                      return result;
                    };
                  const value = Reflect.get(client, property);
                  return typeof value === "function"
                    ? value.bind(client)
                    : value;
                },
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await new DataManagement(pool, h.storage).maintenance();
      assert.equal(returned, true);
      assert.equal(
        (
          await h.pool.query(
            "select warned_at from account_activity where owner_id=$1",
            [a.id],
          )
        ).rows[0].warned_at,
        null,
      );
      assert.equal(
        (
          await h.pool.query(
            "select status from user_policy where user_id=$1",
            [a.id],
          )
        ).rows[0].status,
        "active",
      );
      assert.equal(
        (
          await h.pool.query(
            "select owner_id from account_deletion where owner_id=$1",
            [a.id],
          )
        ).rowCount,
        0,
      );
    }));
}

test("export snapshot survives a real encounter deletion and retains photos until the archive commits", () =>
  isolated(async (h) => {
    const a = await h.member("export-delete@example.test");
    const entry = await h.publish(
      a.cookies,
      await h.ready(a.cookies),
      "private",
    );
    const id = (await (await h.call(a.cookies, "/api/v1/me/export", {})).json())
      .export.id;
    let deleted = false;
    const pool = new Proxy(h.pool, {
      get(target, key) {
        if (key === "connect")
          return async () => {
            const c = await target.connect();
            return new Proxy(c, {
              get(client, property) {
                if (property === "query")
                  return async (sql: string, values: unknown[]) => {
                    if (
                      !deleted &&
                      sql.startsWith("select id,state,bytes,width")
                    ) {
                      deleted = true;
                      assert.equal(
                        (
                          await h.call(
                            a.cookies,
                            "/api/v1/encounters/" + entry.id,
                            undefined,
                            "DELETE",
                          )
                        ).status,
                        200,
                      );
                      await h.service.maintenance();
                      assert.equal(h.storage.objects.size, 2);
                    }
                    return client.query(sql, values);
                  };
                const value = Reflect.get(client, property);
                return typeof value === "function" ? value.bind(client) : value;
              },
            });
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await new DataManagement(pool, h.storage).maintenance();
    assert.equal(deleted, true);
    const job = (
      await h.pool.query(
        "select state,attempts,archive from data_export where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(job.state, "ready");
    assert.equal(job.attempts, 0);
    const files = unzip(job.archive),
      data = JSON.parse(files.get("data.json")!.toString());
    assert.equal(data.data.encounters[0].id, entry.id);
    assert.equal(data.data.media[0].state, "ready");
    assert.ok(files.has("photos/" + entry.image.split("/")[2] + "-image.webp"));
    await h.service.maintenance();
    assert.equal(h.storage.objects.size, 0);
    assert.equal((await h.call(a.cookies, entry.image)).status, 404);
  }));
