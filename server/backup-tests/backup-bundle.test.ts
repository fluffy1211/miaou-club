import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { migrateDatabase } from "../src/infrastructure/db/migrations.js";
import { LocalStorage } from "../src/encounters/storage.js";
import {
  captureBundle,
  type CaptureBundleOptions,
} from "../src/ops/backup-bundle.js";
import { assertLocalTestDatabase } from "../src/ops/recovery.js";

// No implicit target, no skip: this suite requires an explicitly provided,
// disposable loopback database and only creates its own random test database.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required for backup bundle tests");
assertLocalTestDatabase(url);
async function exercise(
  run: (options: CaptureBundleOptions, root: string) => Promise<void>,
) {
  const admin = createDatabase(url!);
  const name = `bundle_${randomUUID().replaceAll("-", "")}_test`;
  const temp = await mkdtemp(
    join(realpathSync(tmpdir()), "miaou-bundle-test-"),
  );
  const target = new URL(url!);
  target.pathname = name;
  const db = createDatabase(target.href);
  let created = false;
  try {
    await admin.pool.query(`create database "${name}"`);
    created = true;
    await migrateDatabase(db.pool, "server/drizzle");
    await run(
      {
        pool: db.pool,
        storage: new LocalStorage(join(temp, "source")),
        root: join(temp, "bundle"),
        source: "synthetic-instance",
        writersStopped: true,
        dump: async (snapshot, path, signal) => {
          assert.match(snapshot, /^[a-fA-F0-9-]+$/);
          assert.equal(signal.aborted, false);
          // An independently imported snapshot must see the same retained rows.
          const c = await db.pool.connect();
          try {
            await c.query("begin isolation level repeatable read");
            await c.query(`set transaction snapshot '${snapshot}'`);
            const rows = (await c.query("select count(*)::text n from media"))
              .rows;
            await writeFile(path, Buffer.from("synthetic-dump:" + rows[0].n), {
              mode: 0o600,
              flag: "wx",
            });
            await c.query("rollback");
          } finally {
            c.release();
          }
        },
      },
      temp,
    );
  } finally {
    await closePool(db.pool);
    if (created) await admin.pool.query(`drop database "${name}" with(force)`);
    await closePool(admin.pool);
    await rm(temp, { recursive: true, force: true });
  }
}
async function seed(options: CaptureBundleOptions) {
  await options.pool.query(
    `insert into "user"(id,name,email) values('alice','Synthetic Alice','alice@example.test')`,
  );
  const ids = Array.from({ length: 5 }, () => randomUUID());
  for (const [index, id] of ids.entries()) {
    await options.pool.query(
      `insert into media(id,owner_id,state,bytes,width,height,original_present,expires_at)
      values($1,'alice',$2,20,40,40,true,now()+interval '1 day')`,
      [id, index === 4 ? "deleted" : "ready"],
    );
    if (index !== 3) {
      await options.pool.query(
        `insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date,location_size,location_x,location_y,visibility,deleted_at)
        values($1,'alice',$1,$1,'synthetic','Synthetic cat',current_date,500,1,6000,$2,$3)`,
        [
          id,
          index === 0 ? "private" : "public",
          index === 2 ? new Date() : null,
        ],
      );
    }
    for (const suffix of ["image.webp", "thumb.webp", "original"])
      await options.storage.put(
        `${id}/${suffix}`,
        Buffer.from(`synthetic-${id}-${suffix}`),
        "image/webp",
      );
  }
  return ids;
}
test("bundle imports exported snapshot; retains private/public ready photos, omits deleted/unreferenced/original objects; hashes private files", async () =>
  exercise(async (options) => {
    const ids = await seed(options);
    const manifest = await captureBundle(options);
    assert.equal(manifest.kind, "miaou-remote-backup-bundle");
    assert.equal(manifest.source, options.source);
    assert.equal(manifest.postgresMajor, 17);
    assert.equal(manifest.schema.tables.length, 25);
    assert.ok(manifest.schema.migrations.length >= 14);
    assert.match(manifest.schema.signature, /^[a-f0-9]{64}$/);
    assert.match(manifest.journal.sourceId, /^[a-f0-9-]{36}$/);
    assert.ok(BigInt(manifest.journal.head) >= BigInt(manifest.journal.floor));
    assert.deepEqual(
      manifest.photos.map((photo) => photo.key).sort(),
      ids
        .slice(0, 2)
        .flatMap((id) => [`${id}/image.webp`, `${id}/thumb.webp`])
        .sort(),
    );
    for (const file of [manifest.dump, ...manifest.photos]) {
      const path = join(options.root, file.path);
      const bytes = await readFile(path);
      assert.equal(bytes.length, file.bytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
      );
      assert.equal((await lstat(path)).mode & 0o777, 0o600);
    }
    assert.equal((await lstat(options.root)).mode & 0o777, 0o700);
    assert.equal(
      (await lstat(join(options.root, "manifest.json"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(options.root, "manifest.json"), "utf8")),
      manifest,
    );
    assert.equal((await readdir(options.root)).length, 4);
  }));
test("bundle rejects unquiesced writer assertion and unsafe source before SQL; preserves occupied staging", async () =>
  exercise(async (options, root) => {
    let queried = false;
    const original = options.pool.connect;
    options.pool.connect = (() => {
      queried = true;
      throw new Error("must not connect");
    }) as typeof original;
    try {
      await assert.rejects(
        captureBundle({
          ...options,
          writersStopped: false,
        } as unknown as CaptureBundleOptions),
        /Stopped writers/,
      );
      for (const source of [
        "postgresql://secret@example.test/db",
        "source secret",
        "../escape",
        "UPPER",
      ])
        await assert.rejects(
          captureBundle({ ...options, source }),
          /Invalid source/,
        );
      assert.equal(queried, false);
    } finally {
      options.pool.connect = original;
    }
    const sentinel = join(root, "sentinel");
    await writeFile(sentinel, "keep");
    await assert.rejects(captureBundle({ ...options, root }));
    assert.equal(await readFile(sentinel, "utf8"), "keep");
    const linked = join(root, "linked");
    await symlink(root, linked);
    await assert.rejects(
      captureBundle({ ...options, root: join(linked, "bundle") }),
      /Canonical/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  }));
test("missing retained photo fails closed and rolls back/releases locks; source untouched", async () =>
  exercise(async (options) => {
    const ids = await seed(options);
    await options.storage.remove([`${ids[0]}/thumb.webp`]);
    await assert.rejects(
      captureBundle(options),
      /^Error: Bundle capture failed$/,
    );
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
    assert.equal(
      (await options.pool.query("select count(*)::text n from media")).rows[0]
        .n,
      "5",
    );
    await options.pool.query("set lock_timeout='1s'");
    await options.pool.query("update media set bytes=bytes");
  }));
test("schema drift, failed dump, insecure dump and dump symlink clean only new root", async () =>
  exercise(async (options, root) => {
    await options.pool.query("create table unexpected(value text)");
    await assert.rejects(captureBundle(options));
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
    await options.pool.query("drop table unexpected");
    await assert.rejects(
      captureBundle({
        ...options,
        dump: async () => {
          throw new Error("sensitive-error");
        },
      }),
      /^Error: Bundle capture failed$/,
    );
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
    await assert.rejects(
      captureBundle({
        ...options,
        dump: async (_snapshot, path) => {
          await writeFile(path, "synthetic");
          await chmod(path, 0o644);
        },
      }),
    );
    const sentinel = join(root, "sentinel");
    await writeFile(sentinel, "keep", { mode: 0o600 });
    await assert.rejects(
      captureBundle({
        ...options,
        dump: async (_snapshot, path) => {
          await symlink(sentinel, path);
        },
      }),
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
  }));
test("capture deadline aborts dump, waits its cleanup and removes staging", async () =>
  exercise(async (options) => {
    let terminated = false;
    await assert.rejects(
      captureBundle({
        ...options,
        deadlineMs: 100,
        dump: async (_snapshot, path, signal) => {
          await writeFile(path, "partial", { mode: 0o600 });
          await new Promise<void>((_resolve, reject) => {
            const abort = () => {
              terminated = true;
              reject(new Error("aborted"));
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        },
      }),
    );
    assert.equal(terminated, true);
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
    await options.pool.query("update recovery_state set head=head");
  }));
test("capture rejects concurrent official migration lock", async () =>
  exercise(async (options) => {
    const c = await options.pool.connect();
    try {
      await c.query("select pg_advisory_lock(1296646485,6)");
      await assert.rejects(captureBundle(options));
      await assert.rejects(lstat(options.root), { code: "ENOENT" });
    } finally {
      await c.query("select pg_advisory_unlock(1296646485,6)");
      c.release();
    }
  }));

test("capture table locks reject a concurrent writer until bundle completes", async () =>
  exercise(async (options) => {
    await seed(options);
    const realDump = options.dump;
    await captureBundle({
      ...options,
      dump: async (snapshot, path, signal) => {
        const writer = await options.pool.connect();
        try {
          await writer.query("begin");
          await writer.query("set local lock_timeout='50ms'");
          await assert.rejects(writer.query("update media set bytes=21"), {
            code: "55P03",
          });
        } finally {
          await writer.query("rollback");
          writer.release();
        }
        await realDump(snapshot, path, signal);
      },
    });
    await options.pool.query("update media set bytes=21");
  }));

test("stalled storage read hits deadline; its later completion cannot recreate cleaned staging", async () =>
  exercise(async (options) => {
    await seed(options);
    let complete: ((bytes: Buffer) => void) | undefined;
    const storage = {
      put: options.storage.put.bind(options.storage),
      remove: options.storage.remove.bind(options.storage),
      get: () =>
        new Promise<Buffer>((resolve) => {
          complete = resolve;
        }),
    };
    await assert.rejects(
      captureBundle({ ...options, storage, deadlineMs: 150 }),
    );
    assert.ok(complete);
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
    complete(Buffer.from("late-synthetic-read"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.rejects(lstat(options.root), { code: "ENOENT" });
    await options.pool.query("update media set bytes=bytes");
  }));
