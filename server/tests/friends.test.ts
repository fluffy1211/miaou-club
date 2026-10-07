import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import sharp from "sharp";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import * as schema from "../src/infrastructure/db/schema.js";
import { createAuth } from "../src/infrastructure/auth/auth.js";
import { accountsHTTP } from "../src/accounts/http.js";
import { identity } from "../src/accounts/security.js";
import { cleanupAccounts } from "../src/accounts/cleanup.js";
import { Friends } from "../src/friends/service.js";
import { friendsHTTP } from "../src/friends/http.js";
import { DataManagement } from "../src/data/service.js";
import { Encounters } from "../src/encounters/service.js";
import { encountersHTTP } from "../src/encounters/http.js";
import type { ObjectStorage } from "../src/encounters/storage.js";
const origin = "http://localhost:43991";
const databaseURL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test";
if (!new URL(databaseURL).pathname.endsWith("_test"))
  throw new Error("Dedicated test DB required");
class Storage implements ObjectStorage {
  objects = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.objects.set(key, bytes);
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("Missing synthetic object");
    return bytes;
  }
  async remove(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
  }
}
async function setup(url: string, folder = "server/drizzle") {
  const { db, pool } = createDatabase(url);
  await migrate(db, { migrationsFolder: folder });
  const auth = createAuth(
    db,
    {
      secret: "synthetic-friends-test-secret-more-than-32-characters",
      baseURL: origin,
      termsVersion: "synthetic-terms-v1",
    },
    schema,
  );
  const friends = new Friends(pool),
    storage = new Storage(),
    data = new DataManagement(pool, storage),
    encounters = new Encounters(pool, storage);
  async function member(handle: string) {
    const email = handle + "@example.test";
    await pool.query("insert into admission(email) values($1)", [email]);
    const r = await accountsHTTP(
      new Request(origin + "/api/auth/sign-up/email", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "synthetic-password-long",
          name: "Synthetic " + handle,
          acceptedTerms: true,
        }),
      }),
      db,
      auth,
    );
    assert.equal(r.status, 200);
    const user = (await r.json()).user;
    await pool.query("update profile set handle=$1 where user_id=$2", [
      handle,
      user.id,
    ]);
    const cookies = r.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    const i = await identity(db, auth, new Headers({ cookie: cookies }));
    assert.ok(i);
    return { id: user.id as string, handle, cookies, i };
  }
  async function call(
    cookies: string,
    path: string,
    method = "GET",
    from = origin,
  ) {
    const request = new Request(origin + path, {
      method,
      headers: { cookie: cookies, origin: from },
    });
    return (
      (await friendsHTTP(request, db, auth, friends)) ??
      (await accountsHTTP(request, db, auth))
    );
  }
  return { db, pool, auth, friends, storage, data, encounters, member, call };
}
async function isolated(
  run: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  folder?: string,
) {
  const admin = createDatabase(databaseURL),
    name = "friends_" + randomUUID().replaceAll("-", "") + "_test";
  await admin.pool.query(`create database "${name}"`);
  const url = new URL(databaseURL);
  url.pathname = name;
  let h: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    h = await setup(url.href, folder);
    await run(h);
  } finally {
    if (h) await closePool(h.pool);
    await admin.pool.query(`drop database "${name}" with(force)`);
    await closePool(admin.pool);
  }
}
const base = "/api/v1/me/friends";
const reject = (code: string, status?: number) => (e: unknown) =>
  e instanceof Error &&
  "code" in e &&
  e.code === code &&
  (status === undefined || ("status" in e && e.status === status));
function unzip(buffer: Buffer) {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18),
      n = buffer.readUInt16LE(at + 26),
      extra = buffer.readUInt16LE(at + 28),
      start = at + 30 + n + extra;
    files.set(
      buffer.subarray(at + 30, at + 30 + n).toString(),
      buffer.subarray(start, start + size),
    );
    at = start + size;
  }
  return files;
}
test("friend requests serialize retries and crossed requests; acceptance is explicit and owner-only lists stay private", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob"),
      c = await h.member("chloe");
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        h.friends.request(n % 2 ? a.i : b.i, n % 2 ? b.handle : a.handle),
      ),
    );
    assert.equal(new Set(responses.map((r) => r.id)).size, 1);
    const row = (await h.pool.query("select * from friendship")).rows[0];
    assert.equal(row.state, "pending");
    assert.equal(
      (await h.pool.query("select count(*)::int n from friend_attempt")).rows[0]
        .n,
      1,
    );
    const sender = row.sender_id === a.id ? a : b,
      receiver = sender === a ? b : a;
    assert.equal((await h.friends.list(sender.i, "sent")).people.length, 1);
    assert.equal(
      (await h.friends.list(receiver.i, "received")).people.length,
      1,
    );
    assert.equal((await h.friends.list(c.i, "received")).people.length, 0);
    assert.equal(
      (await h.call(c.cookies, base + "?ownerId=" + sender.id + "&kind=sent"))
        .status,
      200,
    );
    assert.equal(
      (
        await (
          await h.call(c.cookies, base + "?ownerId=" + sender.id + "&kind=sent")
        ).json()
      ).people.length,
      0,
    );
    assert.equal(
      (await h.call(sender.cookies, base + "/" + row.id + "/accept", "POST"))
        .status,
      403,
    );
    assert.equal(
      (await h.call(c.cookies, base + "/" + row.id + "/accept", "POST")).status,
      404,
    );
    const accepted = await Promise.all(
      Array.from({ length: 6 }, () =>
        h.friends.act(receiver.i, row.id, "accept"),
      ),
    );
    assert.equal(accepted.length, 6);
    assert.equal(
      (await h.friends.list(sender.i, "friends")).people[0].handle,
      receiver.handle,
    );
    assert.equal((await h.friends.list(c.i, "friends")).people.length, 0);
    const list = await h.call(receiver.cookies, base);
    assert.equal(list.headers.get("cache-control"), "no-store");
    const text = await list.text();
    assert.ok(!text.includes(sender.id));
    assert.ok(!text.includes("@example.test"));
    assert.ok(!text.includes("bio"));
    // Existing profile router rejects the slash suffix as an invalid handle.
    const foreignList = await h.call(
      c.cookies,
      "/api/v1/profiles/" + sender.handle + "/friends",
    );
    assert.equal(foreignList.status, 400);
    assert.deepEqual(await foreignList.json(), { code: "invalid_request" });
  }));
test("refusal cancellation and removal delete social rows immediately; immediate repeat requests consume only global counters", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    const first = await h.friends.request(a.i, b.handle);
    await assert.rejects(
      () => h.friends.act(b.i, first.id, "cancel"),
      reject("forbidden", 403),
    );
    await assert.rejects(
      () => h.friends.act(a.i, first.id, "refuse"),
      reject("forbidden", 403),
    );
    await h.friends.act(b.i, first.id, "refuse");
    assert.equal(
      (await h.pool.query("select count(*)::int n from friendship")).rows[0].n,
      0,
    );
    const second = await h.friends.request(a.i, b.handle);
    assert.notEqual(second.id, first.id);
    await assert.rejects(
      () => h.friends.act(b.i, first.id, "accept"),
      reject("not_found", 404),
    );
    await h.friends.act(a.i, second.id, "cancel");
    const third = await h.friends.request(b.i, a.handle);
    await h.friends.act(a.i, third.id, "accept");
    await assert.rejects(
      () => h.friends.act(b.i, third.id, "cancel"),
      reject("forbidden", 403),
    );
    await h.friends.act(a.i, third.id, "remove");
    assert.equal(
      (await h.pool.query("select count(*)::int n from friendship")).rows[0].n,
      0,
    );
    assert.equal(
      (await h.pool.query("select count(*)::int n from friend_attempt")).rows[0]
        .n,
      3,
    );
    const fields = (
      await h.pool.query(
        "select column_name from information_schema.columns where table_name='friend_attempt'",
      )
    ).rows
      .map((x) => x.column_name)
      .sort();
    assert.deepEqual(fields, ["created_at", "id", "owner_id"]);
    await h.friends.request(a.i, b.handle);
  }));
test("hourly and daily friend limits survive service restart, serialize concurrent reservations and expire without retaining a social history", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    for (let n = 0; n < 9; n++) {
      const r = await h.friends.request(a.i, b.handle);
      await h.friends.act(a.i, r.id, "cancel");
    }
    const others = await Promise.all([
      h.member("chloe"),
      h.member("daniel"),
      h.member("emilie"),
    ]);
    const results = await Promise.allSettled(
      others.map((p) => new Friends(h.pool).request(a.i, p.handle)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results)
      if (r.status === "rejected") {
        assert.ok(reject("friend_limited", 429)(r.reason));
        assert.ok(r.reason.retryAfter > 0);
      }
    assert.equal(
      (
        await h.pool.query(
          "select count(*)::int n from friend_attempt where owner_id=$1",
          [a.id],
        )
      ).rows[0].n,
      10,
    );
    const pending = (await h.pool.query("select id from friendship")).rows[0];
    const target = (await h.friends.list(a.i, "sent")).people[0];
    assert.equal(
      (await new Friends(h.pool).request(a.i, target.handle)).id,
      pending.id,
    );
    await h.friends.act(a.i, pending.id, "cancel");
    await assert.rejects(
      () => new Friends(h.pool).request(a.i, b.handle),
      reject("friend_limited", 429),
    );
    await h.pool.query(
      "update friend_attempt set created_at=now()-interval '2 hours' where owner_id=$1",
      [a.id],
    );
    for (let n = 0; n < 2; n++) {
      for (let j = 0; j < 10; j++) {
        const r = await new Friends(h.pool).request(a.i, b.handle);
        await h.friends.act(a.i, r.id, "cancel");
      }
      if (n === 0)
        await h.pool.query(
          "update friend_attempt set created_at=now()-interval '2 hours' where owner_id=$1",
          [a.id],
        );
    }
    // Both windows are exhausted: the displayed retry must cover the longer daily bound.
    const simultaneous = await h.call(
      a.cookies,
      base + "/requests/bob",
      "POST",
    );
    assert.equal(simultaneous.status, 429);
    assert.ok(Number(simultaneous.headers.get("retry-after")) > 20 * 3600);
    await h.pool.query(
      "update friend_attempt set created_at=now()-interval '2 hours' where owner_id=$1",
      [a.id],
    );
    const blocked = await h.call(a.cookies, base + "/requests/bob", "POST");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(
      (
        await h.pool.query(
          "select count(*)::int n from friend_attempt where owner_id=$1",
          [a.id],
        )
      ).rows[0].n,
      30,
    );
    await h.pool.query(
      "update friend_attempt set created_at=now()-interval '25 hours' where owner_id=$1",
      [a.id],
    );
    await cleanupAccounts(h.db);
    assert.equal(
      (await h.pool.query("select count(*)::int n from friend_attempt")).rows[0]
        .n,
      0,
    );
    await new Friends(h.pool).request(a.i, b.handle);
  }));
test("friend HTTP gates anonymous, unadmitted, withdrawn, suspended, deleting and foreign origin; transactions recheck stale identities", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    assert.equal((await h.call("", base)).status, 401);
    assert.equal(
      (
        await h.call(
          a.cookies,
          base + "/requests/bob",
          "POST",
          "https://foreign.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await h.call(a.cookies, base + "/requests/%ZZ", "POST")).status,
      400,
    );
    assert.equal(
      (await h.call(a.cookies, base + "/requests/alice", "POST")).status,
      404,
    );
    assert.equal(
      (await h.call(a.cookies, base + "/requests/unknown", "POST")).status,
      404,
    );
    assert.equal((await h.call(a.cookies, "/api/v1/people?q=%25")).status, 400);
    for (const change of [
      "status='suspended'",
      "status='deleting'",
      "admitted=false",
      "accepted_at=null",
      "terms_version=null",
    ]) {
      await h.pool.query(
        "update user_policy set " + change + " where user_id=$1",
        [a.id],
      );
      assert.equal((await h.call(a.cookies, base)).status, 403);
      assert.equal(
        (await h.call(a.cookies, "/api/v1/people?q=bob")).status,
        403,
      );
      await assert.rejects(
        () => h.friends.request(a.i, b.handle),
        reject("forbidden", 403),
      );
      await h.pool.query(
        "update user_policy set status='active',admitted=true,accepted_at=now(),terms_version='synthetic-terms-v1' where user_id=$1",
        [a.id],
      );
    }
    await h.pool.query(
      "update admission set active=false where email='alice@example.test'",
    );
    assert.equal((await h.call(a.cookies, base)).status, 403);
    await assert.rejects(
      () => h.friends.request(a.i, b.handle),
      reject("forbidden", 403),
    );
    assert.equal(
      (await h.pool.query("select count(*)::int n from friend_attempt")).rows[0]
        .n,
      0,
    );
  }));
test("unavailable peers have no discoverable profiles yet their requests and relations can still be refused/cancelled/removed", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    let r = await h.friends.request(a.i, b.handle);
    await h.pool.query(
      "update user_policy set status='suspended' where user_id=$1",
      [a.id],
    );
    assert.equal((await h.friends.search(b.i, "alice")).people.length, 0);
    const received = (await h.friends.list(b.i, "received")).people[0];
    assert.equal(received.handle, null);
    assert.equal(received.displayName, "Membre indisponible");
    assert.equal(received.available, false);
    await assert.rejects(
      () => h.friends.act(b.i, r.id, "accept"),
      reject("not_found", 404),
    );
    await h.friends.act(b.i, r.id, "refuse");
    await h.pool.query(
      "update user_policy set status='active' where user_id=$1",
      [a.id],
    );
    r = await h.friends.request(a.i, b.handle);
    await h.friends.act(b.i, r.id, "accept");
    await h.pool.query(
      "update admission set active=false where email='alice@example.test'",
    );
    assert.equal((await h.friends.list(b.i, "friends")).people[0].handle, null);
    await h.friends.act(b.i, r.id, "remove");
    assert.equal(
      (await h.pool.query("select count(*)::int n from friendship")).rows[0].n,
      0,
    );
    await assert.rejects(
      () => h.friends.request(b.i, a.handle),
      reject("not_found", 404),
    );
  }));
test("friendship never opens private encounters/images or third-party social lists; public profile stays behind admission", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    const r = await h.friends.request(a.i, b.handle);
    await h.friends.act(b.i, r.id, "accept");
    const bytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#bcdccb" },
    })
      .png()
      .toBuffer();
    const upload = await encountersHTTP(
      new Request(origin + "/api/v1/media", {
        method: "POST",
        headers: {
          cookie: a.cookies,
          origin,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
      }),
      h.db,
      h.auth,
      h.encounters,
    );
    assert.equal(upload!.status, 201);
    const media = (await upload!.json()).media;
    const entry = await h.encounters.publish(
      a.i,
      {
        mediaId: media.id,
        title: "Private synthetic memory",
        encounterDate: "2026-10-07",
        visibility: "private",
      },
      randomUUID(),
    );
    await assert.rejects(
      () => h.encounters.detail(b.i, entry.id),
      reject("not_found", 404),
    );
    await assert.rejects(
      () => h.encounters.image(b.i, media.id, "image"),
      reject("not_found", 404),
    );
    assert.equal(
      (await h.encounters.discover(b.i, { handle: a.handle })).encounters
        .length,
      0,
    );
    const profile = await accountsHTTP(
      new Request(origin + "/api/v1/profiles/alice", {
        headers: { cookie: b.cookies },
      }),
      h.db,
      h.auth,
    );
    assert.equal(profile.status, 200);
    const json = await profile.json();
    assert.ok(!("friends" in json));
    assert.ok(!("friends" in json.profile));
    assert.equal(
      (
        await accountsHTTP(
          new Request(origin + "/api/v1/profiles/alice"),
          h.db,
          h.auth,
        )
      ).status,
      401,
    );
  }));
test("friend lists and people searches paginate without duplicates, cursor lookup or wildcard expansion", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    // Explicit synthetic DB fixture: 35 accounts, enough to cross the page bound.
    for (let n = 0; n < 35; n++) {
      const id = "fixture_" + n,
        handle = "synthetic_" + String(n).padStart(3, "0");
      await h.pool.query(
        'insert into "user"(id,name,email,email_verified,created_at,updated_at) values($1,$2,$3,true,now(),now())',
        [id, "Synthetic member", handle + "@example.test"],
      );
      await h.pool.query(
        "insert into profile(user_id,handle,display_name) values($1,$2,$3)",
        [id, handle, "Synthetic member"],
      );
      await h.pool.query("insert into admission(email) values($1)", [
        handle + "@example.test",
      ]);
      await h.pool.query(
        "insert into user_policy(user_id,status,admitted,accepted_at,terms_version) values($1,'active',true,now(),'synthetic-terms-v1')",
        [id],
      );
      const [low, high] = [a.id, id].sort();
      await h.pool.query(
        "insert into friendship(id,low_id,high_id,sender_id,state,accepted_at) values($1,$2,$3,$4,'accepted',now())",
        [randomUUID(), low, high, a.id],
      );
    }
    const page = await h.friends.list(a.i, "friends");
    assert.equal(page.people.length, 30);
    assert.ok(page.next);
    // Removing the cursor row does not invalidate the next page.
    await h.friends.act(a.i, page.next, "remove");
    const rest = await h.friends.list(a.i, "friends", page.next);
    assert.equal(rest.people.length, 5);
    assert.equal(rest.next, null);
    assert.equal(
      new Set([...page.people, ...rest.people].map((p) => p.id)).size,
      35,
    );
    assert.equal((await h.friends.list(b.i, "friends")).people.length, 0);
    const found = await h.friends.search(a.i, "synthetic_");
    assert.equal(found.people.length, 30);
    assert.ok(found.next);
    assert.equal(
      (await h.friends.search(a.i, "synthetic_", found.next)).people.length,
      5,
    );
    assert.equal((await h.friends.search(a.i, "tic_000")).people.length, 1);
    assert.equal((await h.friends.search(a.i, "zzz_")).people.length, 0);
    assert.equal(
      (await h.call(a.cookies, base + "?after=not-a-cursor")).status,
      400,
    );
  }));
test("friend exports mask unavailable peers in JSON and CSV while retaining directions and dates", async () => {
  for (const unavailable of [
    "suspended",
    "withdrawn",
    "unadmitted",
    "terms",
    "acceptance",
  ]) {
    await isolated(async (h) => {
      const owner = await h.member("owner"),
        accepted = await h.member("acceptedpeer"),
        sent = await h.member("sentpeer"),
        received = await h.member("receivedpeer");
      const request = await h.friends.request(owner.i, accepted.handle);
      await h.friends.act(accepted.i, request.id, "accept");
      await h.friends.request(owner.i, sent.handle);
      await h.friends.request(received.i, owner.handle);
      for (const peer of [accepted, sent, received]) {
        if (unavailable === "withdrawn")
          await h.pool.query(
            "update admission set active=false where email=$1",
            [peer.handle + "@example.test"],
          );
        else {
          const update = {
            suspended: "status='suspended'",
            unadmitted: "admitted=false",
            terms: "terms_version=null",
            acceptance: "accepted_at=null",
          }[unavailable]!;
          await h.pool.query(
            `update user_policy set ${update} where user_id=$1`,
            [peer.id],
          );
        }
      }
      const job = await h.data.requestExport(owner.i);
      await h.data.maintenance();
      const files = unzip(await h.data.download(owner.i, job.id));
      const exported = JSON.parse(files.get("data.json")!.toString()).data;
      assert.equal(exported.friends.length, 1);
      assert.equal(exported.friend_requests.length, 2);
      assert.equal(exported.friends[0].peer_handle, null, unavailable);
      assert.equal(exported.friends[0].request_direction, "sent");
      assert.ok(exported.friends[0].accepted_at);
      assert.deepEqual(
        exported.friend_requests
          .map((row: { direction: string }) => row.direction)
          .sort(),
        ["received", "sent"],
      );
      for (const kind of ["friends", "friend_requests"]) {
        for (const row of exported[kind]) {
          assert.equal(row.peer_handle, null, unavailable);
          assert.ok(row.created_at);
        }
        const csv = files.get("tables/" + kind + ".csv")!.toString();
        for (const peer of [accepted, sent, received])
          assert.ok(!csv.includes(peer.handle), unavailable + " CSV");
      }
    });
  }
});
test("friend data enters JSON/CSV export with minimal peer handles and no third-party graph, then account deletion purges links and own counters", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob"),
      c = await h.member("chloe"),
      d = await h.member("daniel");
    const accepted = await h.friends.request(a.i, b.handle);
    await h.friends.act(b.i, accepted.id, "accept");
    await h.friends.request(c.i, a.handle);
    await h.friends.request(a.i, d.handle);
    await h.friends.request(b.i, d.handle);
    const job = await h.data.requestExport(a.i);
    await h.data.maintenance();
    const files = unzip(await h.data.download(a.i, job.id));
    const exported = JSON.parse(files.get("data.json")!.toString()).data;
    assert.equal(exported.friends.length, 1);
    assert.equal(exported.friends[0].peer_handle, "bob");
    assert.equal(exported.friends[0].request_direction, "sent");
    assert.ok(exported.friends[0].created_at);
    assert.ok(exported.friends[0].accepted_at);
    assert.deepEqual(
      exported.friend_requests
        .map((r: { peer_handle: string; direction: string }) => [
          r.peer_handle,
          r.direction,
        ])
        .sort(),
      [
        ["chloe", "received"],
        ["daniel", "sent"],
      ],
    );
    assert.equal(exported.friend_attempts.length, 2);
    for (const kind of ["friends", "friend_requests", "friend_attempts"])
      assert.ok(files.has("tables/" + kind + ".csv"));
    const social = JSON.stringify([
      exported.friends,
      exported.friend_requests,
      exported.friend_attempts,
    ]);
    for (const peer of [b, c, d]) {
      assert.ok(!social.includes(peer.id));
      assert.ok(!social.includes(peer.handle + "@example.test"));
    }
    assert.ok(!social.includes("bio"));
    assert.ok(!social.includes(accepted.id));
    await assert.rejects(
      () => h.data.download(b.i, job.id),
      reject("not_found", 404),
    );
    await h.data.deletion(a.i, "SUPPRIMER");
    assert.equal(
      (
        await h.pool.query(
          "select count(*)::int n from friendship where low_id=$1 or high_id=$1",
          [a.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await h.pool.query(
          "select count(*)::int n from friend_attempt where owner_id=$1",
          [a.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await h.friends.list(b.i, "sent")).people[0].handle,
      "daniel",
    );
    await h.data.maintenance();
    assert.equal(
      (await h.pool.query('select id from "user" where id=$1', [a.id]))
        .rowCount,
      0,
    );
    assert.equal(
      (await h.pool.query("select count(*)::int n from friendship")).rows[0].n,
      1,
    );
  }));
test("friend migration upgrades lot 5 without losing existing profiles and forbids self/duplicate/invalid-state pairs with cascading purge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-friends-upgrade-"));
  try {
    await cp("server/drizzle", dir, { recursive: true });
    const path = join(dir, "meta/_journal.json"),
      journal = JSON.parse(await readFile(path, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx < 11,
    );
    await writeFile(path, JSON.stringify(journal));
    await isolated(async (h) => {
      const a = await h.member("alice"),
        b = await h.member("bob");
      assert.equal(
        (await h.pool.query("select to_regclass('friendship') t")).rows[0].t,
        null,
      );
      await migrate(h.db, { migrationsFolder: "server/drizzle" });
      assert.equal(
        (
          await h.pool.query("select handle from profile where user_id=$1", [
            a.id,
          ])
        ).rows[0].handle,
        "alice",
      );
      const r = await h.friends.request(a.i, b.handle);
      const row = (await h.pool.query("select * from friendship")).rows[0];
      await assert.rejects(
        () =>
          h.pool.query(
            "insert into friendship(id,low_id,high_id,sender_id) values($1,$2,$3,$4)",
            [randomUUID(), row.low_id, row.high_id, a.id],
          ),
        { code: "23505" },
      );
      await assert.rejects(
        () =>
          h.pool.query(
            "insert into friendship(id,low_id,high_id,sender_id) values($1,$2,$2,$2)",
            [randomUUID(), a.id],
          ),
        { code: "23514" },
      );
      await assert.rejects(
        () =>
          h.pool.query("update friendship set state='accepted' where id=$1", [
            r.id,
          ]),
        { code: "23514" },
      );
      await h.pool.query('delete from "user" where id=$1', [a.id]);
      assert.equal(
        (await h.pool.query("select count(*)::int n from friendship")).rows[0]
          .n,
        0,
      );
      assert.equal(
        (await h.pool.query("select count(*)::int n from friend_attempt"))
          .rows[0].n,
        0,
      );
    }, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a suspension committed while the request waits is rechecked under policy locks without social rows or quota consumption", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    const blocker = await h.pool.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "update user_policy set status='suspended' where user_id=$1",
        [b.id],
      );
      const outcome = h.friends.request(a.i, b.handle).then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      let waiting = false;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const activities = await h.pool.query(
          "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%where f.handle=$1%' and pid<>pg_backend_pid()",
        );
        if (activities.rowCount) {
          waiting = true;
          break;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await blocker.query("commit");
      const result = await outcome;
      assert.ok(waiting, "request must wait on the policy transaction");
      assert.ok(reject("not_found", 404)(result.error));
      assert.equal(
        (await h.pool.query("select count(*)::int n from friendship")).rows[0]
          .n,
        0,
      );
      assert.equal(
        (await h.pool.query("select count(*)::int n from friend_attempt"))
          .rows[0].n,
        0,
      );
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  }));
test("failed friendship insertion rolls back its counter; concurrent acceptance/removal never resurrects a removed relation", () =>
  isolated(async (h) => {
    const a = await h.member("alice"),
      b = await h.member("bob");
    await h.pool.query(
      `create function synthetic_friend_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic persistence failure'; end $$; create trigger synthetic_friend_failure before insert on friendship for each row execute function synthetic_friend_failure()`,
    );
    const failed = await h.call(a.cookies, base + "/requests/bob", "POST");
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { code: "unavailable" });
    assert.equal(
      (await h.pool.query("select count(*)::int n from friend_attempt")).rows[0]
        .n,
      0,
    );
    await h.pool.query(
      "drop trigger synthetic_friend_failure on friendship; drop function synthetic_friend_failure()",
    );
    const r = await h.friends.request(a.i, b.handle);
    await h.friends.act(b.i, r.id, "accept");
    const results = await Promise.allSettled([
      h.friends.act(a.i, r.id, "remove"),
      h.friends.act(b.i, r.id, "accept"),
    ]);
    assert.equal(results[0].status, "fulfilled");
    if (results[1].status === "rejected")
      assert.ok(reject("not_found", 404)(results[1].reason));
    assert.equal(
      (await h.pool.query("select count(*)::int n from friendship")).rows[0].n,
      0,
    );
  }));
