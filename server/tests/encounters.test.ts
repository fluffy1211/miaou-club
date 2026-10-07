import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  mkdir,
  copyFile,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { createAuth } from "../src/infrastructure/auth/auth.js";
import * as schema from "../src/infrastructure/db/schema.js";
import { accountsHTTP } from "../src/accounts/http.js";
import { encountersHTTP } from "../src/encounters/http.js";
import { Encounters } from "../src/encounters/service.js";
import {
  LocalStorage,
  SupabaseStorage,
  type ObjectStorage,
  objectKeys,
} from "../src/encounters/storage.js";
import { optimize, InvalidPhoto } from "../src/encounters/pipeline.js";
import {
  fromPosition,
  enlarge,
  contains,
  forward,
  inverse,
  onMainland,
  cell,
} from "../src/encounters/location.js";
const origin = "http://localhost:43991";
test("Lambert-93 fixed grid, mainland perimeter, accuracy and nested enlargement", () => {
  const p = forward(3, 46.5);
  assert.ok(Math.abs(p[0] - 700000) < 0.01);
  assert.ok(Math.abs(p[1] - 6600000) < 0.01);
  const c = fromPosition(2.3, 48.8, 500);
  assert.ok(contains(c, enlarge(c, 1000)));
  assert.ok(contains(c, enlarge(c, 2000)));
  assert.ok(!contains(enlarge(c, 2000), c));
  assert.ok(!contains(c, { ...c, x: c.x + 1 }));
  assert.ok(!contains(null, c));
  for (const [lon, lat] of [
    [8.74, 41.92],
    [-61.5, 16.2],
    [4.35, 50.85],
    [-0.1, 51.5],
    [2.1, 41.4],
  ])
    assert.equal(onMainland(lon, lat), false);
  for (const [lon, lat] of [
    [2.3, 48.8],
    [-4.49, 48.39],
    [7.75, 48.58],
    [-1.56, 43.48],
  ])
    assert.equal(onMainland(lon, lat), true);
  assert.throws(() => fromPosition(2.3, 48.8, 1000, 800));
  assert.throws(() => cell({ ...c, latitude: 48.8 }));
  assert.throws(() => cell({ ...c, x: NaN }));
  const q = inverse(p[0], p[1]);
  assert.ok(Math.abs(q[0] - 3) < 1e-8);
});
test("discovery, profiles and map revoke shared content while owner notebook stays available; no precise coordinates accepted", async () => {
  await isolated(async (h) => {
    const a = await h.member("discover-author@example.test"),
      b = await h.member("discover-reader@example.test");
    for (const handle of ["%ZZ", "%E0%A4%A", "%2F"]) {
      assert.equal(
        (await h.call(b.cookies, "/api/v1/profiles/" + handle + "/encounters"))
          .status,
        400,
      );
      const profile = await accountsHTTP(
        new Request(origin + "/api/v1/profiles/" + handle, {
          headers: { cookie: b.cookies },
        }),
        h.db,
        h.auth,
      );
      assert.equal(profile.status, 400);
    }
    await h.pool.query(
      "update profile set handle='synthetic_author' where user_id=$1",
      [a.id],
    );
    const location = fromPosition(2.3, 48.8);
    const id = await h.ready(a.cookies);
    const published = await h.call(
      a.cookies,
      "/api/v1/encounters",
      { ...input(id), location, locationMethod: "position" },
      "POST",
      randomUUID(),
    );
    assert.equal(published.status, 201);
    const entry = (await published.json()).encounter;
    const routes = [
      "/api/v1/encounters",
      "/api/v1/map",
      "/api/v1/profiles/synthetic_author/encounters",
    ];
    const contours = await h.call(b.cookies, "/api/v1/map/contours");
    assert.equal(contours.status, 200);
    const data = await contours.json();
    assert.equal(data.features.length, 12);
    assert.equal(data.type, "FeatureCollection");
    assert.ok(data.license.includes("odbl"));
    assert.equal((await h.call("", "/api/v1/map/contours")).status, 401);
    for (const path of routes) {
      assert.equal((await h.call("", path)).status, 401);
      const r = await h.call(b.cookies, path);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const data = await r.json();
      assert.equal(data.encounters[0].id, entry.id);
      assert.equal(data.encounters[0].authorHandle, "synthetic_author");
      assert.deepEqual(
        data.encounters[0].location,
        path === "/api/v1/map" ? location : null,
      );
      assert.equal(JSON.stringify(data).includes("example.test"), false);
    }
    const smaller = await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      {
        ...input(id),
        mediaId: undefined,
        location: fromPosition(2.3, 48.8, 500),
        revision: 1,
      },
      "PATCH",
    );
    assert.equal(smaller.status, 409);
    const moved = await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      {
        ...input(id),
        mediaId: undefined,
        location: { ...location, x: location.x + 1 },
        revision: 1,
      },
      "PATCH",
    );
    assert.equal(moved.status, 409);
    const widened = await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      {
        ...input(id),
        mediaId: undefined,
        location: enlarge(location, 2000),
        revision: 1,
      },
      "PATCH",
    );
    assert.equal(widened.status, 200);
    const invalid = await h.call(
      a.cookies,
      "/api/v1/encounters",
      {
        ...input(await h.ready(a.cookies)),
        location: { ...location, longitude: 2.3 },
      },
      "POST",
      randomUUID(),
    );
    assert.equal(invalid.status, 400);
    for (const update of [
      "hidden=true",
      "visibility='private'",
      "deleted_at=now()",
    ]) {
      await h.pool.query(`update encounter set ${update} where id=$1`, [
        entry.id,
      ]);
      for (const path of routes)
        assert.equal(
          (await (await h.call(b.cookies, path)).json()).encounters.length,
          0,
        );
      assert.equal((await h.call(b.cookies, entry.image)).status, 404);
      await h.pool.query(
        "update encounter set hidden=false,visibility='public',deleted_at=null where id=$1",
        [entry.id],
      );
    }
    for (const update of ["status='suspended'", "admitted=false"]) {
      await h.pool.query(`update user_policy set ${update} where user_id=$1`, [
        a.id,
      ]);
      for (const path of routes)
        assert.equal(
          (await (await h.call(b.cookies, path)).json()).encounters.length,
          0,
        );
      assert.equal((await h.call(b.cookies, entry.image)).status, 404);
      assert.equal(
        (await h.call(a.cookies, "/api/v1/me/encounters")).status,
        200,
      );
      await h.pool.query(
        "update user_policy set status='active',admitted=true where user_id=$1",
        [a.id],
      );
    }
    await h.pool.query(
      "update admission set active=false where email='discover-author@example.test'",
    );
    for (const path of routes)
      assert.equal((await h.call(a.cookies, path)).status, 403);
    assert.equal((await h.call(a.cookies, "/api/v1/map/contours")).status, 403);
    assert.equal((await h.call(b.cookies, entry.image)).status, 404);
    await h.pool.query(
      "update admission set active=true where email='discover-author@example.test'",
    );
    const noPlace = await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      { ...input(id), mediaId: undefined, location: null, revision: 2 },
      "PATCH",
    );
    assert.equal(noPlace.status, 200);
    assert.equal(
      (await (await h.call(b.cookies, "/api/v1/map")).json()).encounters.length,
      0,
    );
    assert.equal(
      (await (await h.call(b.cookies, "/api/v1/encounters")).json()).encounters
        .length,
      1,
    );
  });
});
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
  async function member(email: string) {
    await pool.query("insert into admission(email) values($1)", [email]);
    const response = await accountsHTTP(
      new Request(origin + "/api/auth/sign-up/email", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "synthetic-password-long",
          name: "Synthetic member",
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
    return (await encountersHTTP(
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
    ))!;
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
    member,
    call,
    upload,
    ready,
    publish,
  };
}
test("shared pagination is stable at equal publication times, bounded and cannot use private cursors", async () =>
  isolated(async (h) => {
    const a = await h.member("pagination@example.test"),
      b = await h.member("page-reader@example.test");
    const real = await h.publish(a.cookies, await h.ready(a.cookies));
    const stored = (
      await h.pool.query("select * from encounter where id=$1", [real.id])
    ).rows[0];
    const legacyBody = input(stored.media_id);
    const { mediaId, ...legacyFields } = legacyBody;
    const legacyHash = createHash("sha256")
      .update(JSON.stringify({ ...legacyFields, mediaId }))
      .digest("hex");
    await h.pool.query("update encounter set fingerprint=$2 where id=$1", [
      real.id,
      legacyHash,
    ]);
    const replay = await h.call(
      a.cookies,
      "/api/v1/encounters",
      legacyBody,
      "POST",
      stored.request_key,
    );
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).encounter.id, real.id);
    for (let n = 0; n < 32; n++) {
      const mediaId = randomUUID();
      await h.pool.query(
        "insert into media(id,owner_id,state,bytes,width,height,expires_at) values($1,$2,'ready',100,160,80,now()+interval '1 day')",
        [mediaId, a.id],
      );
      h.storage.objects.set(
        mediaId + "/image.webp",
        await h.storage.get(stored.media_id + "/image.webp"),
      );
      h.storage.objects.set(
        mediaId + "/thumb.webp",
        await h.storage.get(stored.media_id + "/thumb.webp"),
      );
      await h.pool.query(
        "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date,published_at) values($1,$2,$3,$4,'synthetic','Pagination fixture','2026-10-03',$5)",
        [randomUUID(), a.id, mediaId, randomUUID(), stored.published_at],
      );
    }
    await h.pool.query(
      "update encounter set published_at='2026-10-06T14:30:00.123456Z' where owner_id=$1",
      [a.id],
    );
    const first = await (await h.call(b.cookies, "/api/v1/encounters")).json();
    assert.equal(first.encounters.length, 30);
    assert.ok(first.next);
    const last = await (
      await h.call(b.cookies, "/api/v1/encounters?after=" + first.next)
    ).json();
    assert.equal(last.encounters.length, 3);
    assert.equal(last.next, null);
    assert.equal(
      new Set([...first.encounters, ...last.encounters].map((e) => e.id)).size,
      33,
    );
    const anchor = JSON.parse(
      Buffer.from(first.next, "base64url").toString(),
    )[1];
    await h.pool.query(
      "update encounter set visibility='private' where id=$1",
      [anchor],
    );
    const afterWithdrawal = await (
      await h.call(b.cookies, "/api/v1/encounters?after=" + first.next)
    ).json();
    assert.equal(afterWithdrawal.encounters.length, 3);
    await h.pool.query(
      "update encounter set visibility='private' where id=$1",
      [real.id],
    );
    assert.equal(
      (await h.call(b.cookies, "/api/v1/encounters?after=" + real.id)).status,
      400,
    );
    assert.equal(
      (await h.call(b.cookies, "/api/v1/encounters?after=malformed")).status,
      400,
    );
  }));
test("pipeline decodes real pixels, corrects orientation, strips metadata and rejects unsupported/oversized input", async () => {
  const result = await optimize(await photo());
  assert.equal(result.width, 80);
  assert.equal(result.height, 160);
  for (const bytes of [result.image, result.thumb]) {
    const m = await sharp(bytes).metadata();
    assert.equal(m.format, "webp");
    for (const field of ["exif", "icc", "xmp", "iptc", "orientation"])
      assert.equal(m[field as keyof typeof m], undefined);
  }
  for (const format of ["png", "webp"] as const) {
    const generated = sharp({
      create: { width: 64, height: 32, channels: 4, background: "#e2d8f0" },
    });
    const bytes = await generated[format]().toBuffer();
    assert.equal((await optimize(bytes)).width, 64);
  }
  await assert.rejects(
    optimize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    (e) => e instanceof InvalidPhoto && e.code === "photo_format",
  );
  await assert.rejects(
    optimize(Buffer.alloc(30000001)),
    (e) => e instanceof InvalidPhoto && e.code === "photo_size",
  );
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  png.writeUInt32BE(8000, 16);
  png.writeUInt32BE(8000, 20);
  await assert.rejects(optimize(png), (e) => e instanceof InvalidPhoto);
  const avif = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .avif()
    .toBuffer();
  await assert.rejects(
    optimize(avif),
    (e) => e instanceof InvalidPhoto && e.code === "photo_format",
  );
  const heic = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypheic"),
    Buffer.alloc(24),
  ]);
  await assert.rejects(
    optimize(heic),
    (e) => e instanceof InvalidPhoto && e.code === "heic_unavailable",
  );
  await assert.rejects(
    optimize((await photo()).subarray(0, 100)),
    (e) => e instanceof InvalidPhoto,
  );
});
test("private/public permissions apply to direct JSON and image requests, ownership and withdrawn personal access", async () =>
  isolated(async (h) => {
    const a = await h.member("author@example.test"),
      b = await h.member("reader@example.test");
    const mediaId = await h.ready(a.cookies),
      entry = await h.publish(a.cookies, mediaId, "private");
    const path = "/api/v1/encounters/" + entry.id,
      image = entry.image;
    for (const url of [
      path,
      image,
      "/api/v1/me/encounters",
      "/api/v1/media/" + mediaId,
    ])
      assert.equal((await h.call("", url)).status, 401);
    for (const url of [path, image, "/api/v1/media/" + mediaId])
      assert.equal((await h.call(b.cookies, url)).status, 404);
    await h.pool.query("update user_policy set role='admin' where user_id=$1", [
      b.id,
    ]);
    assert.equal(
      (await h.call(b.cookies, image)).status,
      404,
      "admin cannot read private notebook",
    );
    const mine = await h.call(a.cookies, image);
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get("cache-control"), "no-store");
    assert.equal(mine.headers.get("content-type"), "image/webp");
    assert.equal(
      (await sharp(Buffer.from(await mine.arrayBuffer())).metadata()).exif,
      undefined,
    );
    assert.equal(
      (
        await h.call(
          b.cookies,
          path,
          { ...input(mediaId), revision: 1 },
          "PATCH",
        )
      ).status,
      400,
      "foreign/unknown media field rejected",
    );
    assert.equal(
      (await h.call(b.cookies, path, undefined, "DELETE")).status,
      404,
    );
    const update = {
      title: "Autre titre",
      description: "",
      encounterDate: "2026-09-01",
      visibility: "public",
      revision: 1,
    };
    const edited = await h.call(a.cookies, path, update, "PATCH");
    assert.equal(edited.status, 200);
    const after = (await edited.json()).encounter;
    assert.equal(after.publishedAt, entry.publishedAt);
    assert.equal(after.image, image);
    assert.equal(after.encounterDate, "2026-09-01");
    assert.equal((await h.call(b.cookies, path)).status, 200);
    assert.equal((await h.call(b.cookies, image)).status, 200);
    const json = JSON.stringify(await (await h.call(b.cookies, path)).json());
    for (const field of [
      "owner_id",
      "email",
      "original",
      "fingerprint",
      "request_key",
      "webp",
    ])
      assert.equal(json.includes(field), false);
    for (const state of ["suspended", "withdrawn"]) {
      await h.pool.query("update user_policy set status=$2 where user_id=$1", [
        a.id,
        state,
      ]);
      assert.equal((await h.call(b.cookies, path)).status, 404);
      assert.equal((await h.call(b.cookies, image)).status, 404);
      assert.equal((await h.call(a.cookies, path)).status, 200);
      assert.equal((await h.call(a.cookies, image)).status, 200);
      assert.equal(
        (await h.call(a.cookies, path, { ...update, revision: 2 }, "PATCH"))
          .status,
        403,
      );
    }
    await h.pool.query(
      "update user_policy set status='active' where user_id=$1",
      [a.id],
    );
    await h.pool.query(
      "update admission set active=false where email='author@example.test'",
    );
    assert.equal((await h.call(b.cookies, image)).status, 404);
    assert.equal((await h.call(a.cookies, image)).status, 200);
    await h.pool.query(
      "update admission set active=true where email='author@example.test'",
    );
    await h.pool.query(
      "update admission set active=false where email='reader@example.test'",
    );
    assert.equal((await h.call(b.cookies, path)).status, 404);
    assert.equal((await h.call(b.cookies, image)).status, 404);
    await h.pool.query(
      "update admission set active=true where email='reader@example.test'",
    );
    await h.pool.query(
      "update encounter set hidden=true,hidden_reason='Motif synthétique' where id=$1",
      [entry.id],
    );
    const editHidden = await h.call(
      a.cookies,
      path,
      { ...update, revision: 2 },
      "PATCH",
    );
    assert.equal(editHidden.status, 200);
    assert.equal(
      (await editHidden.json()).encounter.hiddenReason,
      "Motif synthétique",
    );
    assert.equal((await h.call(b.cookies, image)).status, 404);
    await h.pool.query("update encounter set hidden=false where id=$1", [
      entry.id,
    ]);
    assert.equal(
      (
        await h.call(
          a.cookies,
          path,
          { ...update, visibility: "private", revision: 3 },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call(b.cookies, image)).status,
      404,
      "visibility revocation takes effect on next read",
    );
    assert.equal(
      (await h.call(a.cookies, path, { ...update, revision: 1 }, "PATCH"))
        .status,
      409,
      "stale edits do not overwrite",
    );
    assert.equal(
      (
        await h.call(
          a.cookies,
          path,
          { ...update, revision: 4, photo: image },
          "PATCH",
        )
      ).status,
      400,
      "published photo cannot change",
    );
  }));
test("concurrent publication is durable and idempotent; same media/key cannot duplicate or resurrect deletion", async () =>
  isolated(async (h) => {
    const a = await h.member("author@example.test"),
      b = await h.member("other@example.test");
    const id = await h.ready(a.cookies),
      key = randomUUID();
    assert.equal(
      (
        await h.call(
          b.cookies,
          "/api/v1/encounters",
          input(id),
          "POST",
          randomUUID(),
        )
      ).status,
      409,
    );
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        h.call(a.cookies, "/api/v1/encounters", input(id), "POST", key),
      ),
    );
    for (const r of responses) assert.equal(r.status, 201);
    const entries = await Promise.all(responses.map((r) => r.json()));
    const entry = entries[0].encounter;
    for (const r of entries) assert.equal(r.encounter.id, entry.id);
    assert.equal(
      (await h.pool.query("select count(*) from encounter")).rows[0].count,
      "1",
    );
    assert.equal(
      (
        await h.call(
          a.cookies,
          "/api/v1/encounters",
          { ...input(id), title: "Changed" },
          "POST",
          key,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.call(
          a.cookies,
          "/api/v1/encounters",
          input(id),
          "POST",
          randomUUID(),
        )
      ).status,
      409,
    );
    const restarted = new Encounters(h.pool, h.storage);
    assert.equal(
      (
        await encountersHTTP(
          new Request(origin + "/api/v1/me/encounters", {
            headers: { cookie: a.cookies },
          }),
          h.db,
          h.auth,
          restarted,
        )
      )?.status,
      200,
    );
    const notebook = await (
      await h.call(a.cookies, "/api/v1/me/encounters")
    ).json();
    assert.equal(notebook.encounters[0].id, entry.id);
    h.storage.failDelete = true;
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
    for (const cookies of [a.cookies, b.cookies]) {
      assert.equal((await h.call(cookies, entry.image)).status, 404);
      assert.equal(
        (await h.call(cookies, "/api/v1/encounters/" + entry.id)).status,
        404,
      );
    }
    await restarted.maintenance();
    assert.equal(
      (
        await h.pool.query(
          "select state,purge_attempts from media where id=$1",
          [id],
        )
      ).rows[0].state,
      "deleting",
    );
    assert.ok(h.storage.objects.size > 0);
    assert.equal(
      (await h.call(a.cookies, "/api/v1/encounters", input(id), "POST", key))
        .status,
      410,
    );
    h.storage.failDelete = false;
    await h.pool.query("update media set next_attempt_at=now() where id=$1", [
      id,
    ]);
    await restarted.maintenance();
    assert.equal(h.storage.objects.size, 0);
    assert.equal(
      (await h.pool.query("select state from media where id=$1", [id])).rows[0]
        .state,
      "deleted",
    );
  }));
test("partial storage failure, original purge failure, interrupted upload and expiry are recovered durably", async () =>
  isolated(async (h) => {
    const a = await h.member("author@example.test");
    h.storage.failPutSuffix = "thumb.webp";
    const r = await h.upload(a.cookies);
    assert.equal(r.status, 201);
    const m = (await r.json()).media;
    assert.equal(m.state, "failed");
    assert.equal(m.error, "storage_unavailable");
    assert.ok(h.storage.objects.has(m.id + "/original"));
    assert.equal(
      (
        await h.call(
          a.cookies,
          "/api/v1/encounters",
          input(m.id),
          "POST",
          randomUUID(),
        )
      ).status,
      409,
    );
    h.storage.failPutSuffix = "";
    h.storage.failDelete = true;
    const retry = await h.call(
      a.cookies,
      "/api/v1/media/" + m.id + "/retry",
      undefined,
      "POST",
    );
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).media.state, "ready");
    assert.ok(h.storage.objects.has(m.id + "/original"));
    h.storage.failDelete = false;
    await h.pool.query("update media set next_attempt_at=now() where id=$1", [
      m.id,
    ]);
    await new Encounters(h.pool, h.storage).maintenance();
    assert.equal(h.storage.objects.has(m.id + "/original"), false);
    h.storage.objects.delete(m.id + "/image.webp");
    assert.equal(
      (
        await h.call(
          a.cookies,
          "/api/v1/encounters",
          input(m.id),
          "POST",
          randomUUID(),
        )
      ).status,
      503,
    );
    assert.equal(
      (await h.pool.query("select count(*) from encounter")).rows[0].count,
      "0",
    );
    const interrupted = randomUUID();
    await h.pool.query(
      "insert into media(id,owner_id,bytes,expires_at,state) values($1,$2,100,now()+interval '24 hours','uploading')",
      [interrupted, a.id],
    );
    await h.storage.put(interrupted + "/original", await photo());
    await h.service.maintenance();
    assert.equal(
      (await h.call(a.cookies, "/api/v1/media/" + interrupted)).status,
      200,
    );
    assert.equal(
      (await (await h.call(a.cookies, "/api/v1/media/" + interrupted)).json())
        .media.state,
      "ready",
    );
    await h.pool.query(
      "update media set expires_at=now()-interval '1 second',next_attempt_at=now() where id in($1,$2)",
      [m.id, interrupted],
    );
    await h.service.maintenance();
    assert.equal(h.storage.objects.size, 0);
    assert.equal(
      (await h.call(a.cookies, "/media/" + interrupted + "/image")).status,
      404,
    );
  }));
test("upload limits, concurrent processing, malformed content, CSRF and failed retry cap are enforced", async () =>
  isolated(async (h) => {
    const a = await h.member("author@example.test");
    const c = await h.pool.connect();
    await c.query("select pg_advisory_lock(hashtextextended($1,3))", [a.id]);
    try {
      const blocked = await h.upload(a.cookies);
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers.get("retry-after"), "5");
    } finally {
      await c.query("select pg_advisory_unlock(hashtextextended($1,3))", [
        a.id,
      ]);
      c.release();
    }
    const invalid = (
      await (await h.upload(a.cookies, Buffer.from("not an image"))).json()
    ).media;
    assert.equal(invalid.state, "failed");
    assert.equal(invalid.error, "photo_format");
    assert.equal(
      (await h.call(a.cookies, "/media/" + invalid.id + "/image")).status,
      404,
    );
    const csrf = await encountersHTTP(
      new Request(origin + "/api/v1/media", {
        method: "POST",
        headers: { cookie: a.cookies, origin: "https://evil.example" },
        body: "bad",
      }),
      h.db,
      h.auth,
      h.service,
    );
    assert.equal(csrf?.status, 403);
    await h.pool.query("update media set attempts=3 where id=$1", [invalid.id]);
    assert.equal(
      (
        await h.call(
          a.cookies,
          "/api/v1/media/" + invalid.id + "/retry",
          undefined,
          "POST",
        )
      ).status,
      409,
    );
    await h.pool.query(
      "insert into upload_attempt(id,owner_id,bytes) select gen_random_uuid()::text,$1,1 from generate_series(1,9)",
      [a.id],
    );
    assert.equal((await h.upload(a.cookies)).status, 429);
    await h.pool.query(
      "update upload_attempt set created_at=now()-interval '2 hours'",
    );
    assert.equal(
      (await h.upload(a.cookies)).status,
      201,
      "hourly quota recovers",
    );
    await h.pool.query(
      "update upload_attempt set created_at=now()-interval '2 hours'",
    );
    await h.pool.query(
      "insert into upload_attempt(id,owner_id,bytes,created_at) values($1,$2,600000000,now()-interval '2 hours')",
      [randomUUID(), a.id],
    );
    assert.equal((await h.upload(a.cookies)).status, 429, "daily bytes quota");
    await h.pool.query("delete from upload_attempt");
    await h.pool.query(
      "insert into upload_attempt(id,owner_id,bytes,created_at) select gen_random_uuid()::text,$1,1,now()-interval '2 hours' from generate_series(1,30)",
      [a.id],
    );
    assert.equal((await h.upload(a.cookies)).status, 429, "daily count quota");
  }));
test("local adapter persists across instances; Supabase adapter refuses public buckets and never returns storage URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-photo-test-"));
  const id = randomUUID();
  try {
    const store = new LocalStorage(dir);
    await store.put(id + "/original", await photo());
    const second = new LocalStorage(dir);
    assert.ok((await second.get(id + "/original")).length > 0);
    await second.remove(objectKeys(id));
    await assert.rejects(store.get(id + "/original"));
    await assert.rejects(store.get("../private"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const native = globalThis.fetch;
  const requests: { url: string; method: string }[] = [];
  let isPublic: boolean | undefined = true;
  const bytes = await photo();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/bucket/photos"))
      return Response.json({ id: "photos", name: "photos", public: isPublic });
    if (init?.method === "POST")
      return Response.json({ Key: "photos/" + id + "/image.webp" });
    if (init?.method === "DELETE") return Response.json([]);
    return new Response(new Uint8Array(bytes));
  };
  try {
    const store = new SupabaseStorage(
      "https://synthetic.example",
      "synthetic-server-key",
      "photos",
    );
    await assert.rejects(store.put(id + "/image.webp", bytes, "image/webp"));
    assert.equal(requests.length, 1);
    isPublic = undefined;
    await assert.rejects(store.get(id + "/image.webp"));
    assert.equal(
      requests.length,
      2,
      "missing private-bucket proof fails closed",
    );
    isPublic = false;
    await store.put(id + "/image.webp", bytes, "image/webp");
    assert.deepEqual(await store.get(id + "/image.webp"), bytes);
    await store.remove(objectKeys(id));
    assert.ok(
      requests.some(
        (r) => r.url.includes("/object/photos/") && r.method === "GET",
      ),
    );
    assert.equal(
      requests.some(
        (r) => r.url.includes("/public/") || r.url.includes("/sign/"),
      ),
      false,
    );
  } finally {
    globalThis.fetch = native;
  }
});
test("additive migration upgrades previous lot without changing existing accounts", async () => {
  const admin = createDatabase(databaseURL);
  const name = "migration_" + randomUUID().replaceAll("-", "") + "_test";
  await admin.pool.query(`create database "${name}"`);
  const url = new URL(databaseURL);
  url.pathname = name;
  const { pool, db } = createDatabase(url.href);
  const dir = await mkdtemp(join(tmpdir(), "miaou-previous-"));
  try {
    await mkdir(join(dir, "meta"));
    const journal = JSON.parse(
      await readFile("server/drizzle/meta/_journal.json", "utf8"),
    );
    journal.entries = journal.entries.filter((x: { idx: number }) => x.idx < 5);
    await writeFile(join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries)
      await copyFile(
        "server/drizzle/" + e.tag + ".sql",
        join(dir, e.tag + ".sql"),
      );
    await migrate(db, { migrationsFolder: dir });
    await pool.query(
      'insert into "user"(id,name,email,email_verified,created_at,updated_at) values($1,$2,$3,false,now(),now())',
      ["synthetic-upgrade", "Fixture", "upgrade@example.test"],
    );
    const mediaId = randomUUID(),
      entryId = randomUUID();
    await pool.query(
      "insert into media(id,owner_id,state,bytes,width,height,expires_at) values($1,'synthetic-upgrade','ready',100,160,80,now()+interval '1 day')",
      [mediaId],
    );
    await pool.query(
      "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date) values($1,'synthetic-upgrade',$2,$3,'synthetic','Existing memory','2026-10-03')",
      [entryId, mediaId, randomUUID()],
    );
    await migrate(db, { migrationsFolder: "server/drizzle" });
    assert.equal(
      (
        await pool.query('select count(*) from "user" where id=$1', [
          "synthetic-upgrade",
        ])
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (await pool.query("select count(*) from media")).rows[0].count,
      "1",
    );
    const upgraded = (
      await pool.query(
        "select title,location_size,location_context from encounter where id=$1",
        [entryId],
      )
    ).rows[0];
    assert.equal(upgraded.title, "Existing memory");
    assert.equal(upgraded.location_size, null);
    assert.equal(upgraded.location_context, null);
  } finally {
    await closePool(pool);
    await admin.pool.query(`drop database "${name}" with(force)`);
    await closePool(admin.pool);
    await rm(dir, { recursive: true, force: true });
  }
});

test("publication daily quota counts deleted entries and an idempotent retry does not consume a slot", async () =>
  isolated(async (h) => {
    const a = await h.member("quota@example.test");
    const id = await h.ready(a.cookies),
      key = randomUUID();
    const entry = await h.publish(a.cookies, id, "public", key);
    for (let n = 0; n < 29; n++) {
      const m = randomUUID();
      await h.pool.query(
        "insert into media(id,owner_id,bytes,state,expires_at) values($1,$2,1,'deleted',now())",
        [m, a.id],
      );
      await h.pool.query(
        "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date,deleted_at) values($1,$2,$3,$4,'synthetic','Suppression synthétique','2026-10-03',now())",
        [randomUUID(), a.id, m, randomUUID()],
      );
    }
    const retry = await h.call(
      a.cookies,
      "/api/v1/encounters",
      input(id),
      "POST",
      key,
    );
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).encounter.id, entry.id);
    const another = await h.ready(a.cookies);
    assert.equal(
      (
        await h.call(
          a.cookies,
          "/api/v1/encounters",
          input(another),
          "POST",
          randomUUID(),
        )
      ).status,
      429,
    );
    assert.equal(
      (await h.pool.query("select count(*) from encounter")).rows[0].count,
      "30",
    );
  }));
test("stream byte limit and body size are enforced before a durable publication", async () =>
  isolated(async (h) => {
    const a = await h.member("stream@example.test");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(15000000));
        controller.enqueue(new Uint8Array(15000001));
        controller.close();
      },
    });
    const request = new Request(origin + "/api/v1/media", {
      method: "POST",
      headers: { cookie: a.cookies, origin },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const r = await encountersHTTP(request, h.db, h.auth, h.service);
    assert.equal(r?.status, 413);
    assert.equal(
      (await h.pool.query("select count(*) from media")).rows[0].count,
      "0",
    );
    assert.equal(h.storage.objects.size, 0);
    const tooLarge = await h.call(
      a.cookies,
      "/api/v1/encounters",
      { title: "x".repeat(9000) },
      "POST",
      randomUUID(),
    );
    assert.equal(tooLarge.status, 413);
  }));

test("deleted encounter tombstones expire after seven days and interrupted local temporary writes are removed", async () =>
  isolated(async (h) => {
    const a = await h.member("purge@example.test"),
      id = await h.ready(a.cookies),
      entry = await h.publish(a.cookies, id);
    await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      undefined,
      "DELETE",
    );
    await h.service.maintenance();
    assert.equal(
      (await h.pool.query("select state from media where id=$1", [id])).rows[0]
        .state,
      "deleted",
    );
    await h.pool.query(
      "update encounter set deleted_at=now()-interval '7 days 1 second' where id=$1",
      [entry.id],
    );
    await h.service.maintenance();
    assert.equal(
      (await h.pool.query("select count(*) from encounter")).rows[0].count,
      "0",
    );
    assert.equal(
      (await h.pool.query("select count(*) from media")).rows[0].count,
      "0",
    );
    const dir = await mkdtemp(join(tmpdir(), "miaou-partial-"));
    const m = randomUUID();
    try {
      await mkdir(join(dir, m));
      await writeFile(
        join(dir, m, "original.tmp"),
        "synthetic interrupted write",
      );
      await new LocalStorage(dir).remove(objectKeys(m));
      await assert.rejects(readFile(join(dir, m, "original.tmp")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));

test("maintenance processes deletion behind twenty old published photos without purging live variants", async () =>
  isolated(async (h) => {
    const a = await h.member("queue@example.test");
    const bytes = await optimize(await photo());
    const oldIds: string[] = [];
    for (let n = 0; n < 20; n++) {
      const id = randomUUID();
      oldIds.push(id);
      await h.pool.query(
        "insert into media(id,owner_id,bytes,state,width,height,original_present,expires_at,next_attempt_at) values($1,$2,1,'ready',80,160,false,now()-interval '2 days',now()-interval '3 days')",
        [id, a.id],
      );
      await h.pool.query(
        "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date,published_at) values($1,$2,$3,$4,'synthetic','Ancienne publication synthétique','2026-10-03',now()-interval '3 days')",
        [randomUUID(), a.id, id, randomUUID()],
      );
      await h.storage.put(id + "/image.webp", bytes.image);
      await h.storage.put(id + "/thumb.webp", bytes.thumb);
    }
    const target = await h.ready(a.cookies),
      entry = await h.publish(a.cookies, target);
    await h.call(
      a.cookies,
      "/api/v1/encounters/" + entry.id,
      undefined,
      "DELETE",
    );
    await h.service.maintenance();
    await h.service.maintenance();
    assert.equal(
      h.storage.objects.has(target + "/image.webp"),
      false,
      "new deletion must not starve behind live published media",
    );
    assert.equal(h.storage.objects.has(target + "/thumb.webp"), false);
    assert.equal(
      (await h.pool.query("select state from media where id=$1", [target]))
        .rows[0].state,
      "deleted",
    );
    for (const id of oldIds) {
      assert.equal(h.storage.objects.has(id + "/image.webp"), true);
      assert.equal(h.storage.objects.has(id + "/thumb.webp"), true);
    }
  }));
