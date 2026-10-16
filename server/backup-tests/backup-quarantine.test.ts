import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { migrateDatabase } from "../src/infrastructure/db/migrations.js";
import { assertLocalTestDatabase } from "../src/ops/recovery.js";
import { LocalStorage } from "../src/encounters/storage.js";
import { captureBundle } from "../src/ops/backup-bundle.js";
import {
  captureJournalBundle,
  readJournalBundle,
  restoreQuarantine,
  type JournalOptions,
  type RestoreQuarantineOptions,
} from "../src/ops/backup-quarantine.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required for quarantine tests");
assertLocalTestDatabase(url);
assert.match(
  process.env.MIAOU_BACKUP_TEST_CONTAINER ?? "",
  /^miaou-backup-test-[a-zA-Z0-9-]+$/,
);
const container = process.env.MIAOU_BACKUP_TEST_CONTAINER!;
// Only the named disposable test container; no provider credentials/environment.
async function pg(
  binary: "pg_dump" | "pg_restore",
  db: string,
  args: string[],
  signal: AbortSignal,
  input?: Buffer,
) {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", container, binary, "-U", "miaou_test", "-d", db, ...args],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const output: Buffer[] = [];
    let failure = false;
    const abort = () => {
      failure = true;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (b: Buffer) => output.push(b));
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {
      failure = true;
    });
    child.on("error", () => {
      failure = true;
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (code !== 0 || failure)
        reject(new Error("Synthetic PostgreSQL child failed"));
      else resolve(Buffer.concat(output));
    });
    child.stdin.end(input);
    if (signal.aborted) abort();
  });
}
async function exercise(
  run: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const ctx = await setup();
  try {
    await run(ctx);
  } finally {
    await closePool(ctx.source.pool);
    await closePool(ctx.target.pool);
    for (const name of [ctx.sourceName, ctx.targetName])
      await ctx.admin.pool.query(
        `drop database if exists "${name}" with(force)`,
      );
    await closePool(ctx.admin.pool);
    await rm(ctx.root, { recursive: true, force: true });
  }
}
async function setup() {
  const admin = createDatabase(url!);
  const suffix = randomUUID().replaceAll("-", "");
  const sourceName = `quarantine_${suffix}_test`,
    targetName = `quarantine_${suffix}_quarantine`;
  const root = await mkdtemp(
    join(realpathSync(tmpdir()), "miaou-quarantine-test-"),
  );
  const dbUrl = (name: string) => {
    const u = new URL(url!);
    u.pathname = name;
    return u.href;
  };
  const source = createDatabase(dbUrl(sourceName)),
    target = createDatabase(dbUrl(targetName));
  await admin.pool.query(`create database "${sourceName}"`);
  await admin.pool.query(`create database "${targetName}"`);
  await migrateDatabase(source.pool, "server/drizzle");
  for (const dir of ["journals", "anchors", "keys"])
    await mkdir(join(root, dir), { mode: 0o700 });
  const keyFile = join(root, "keys", "journal.key");
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  const storage = new LocalStorage(join(root, "source-media"));
  const bundleRoot = join(root, "bundle"),
    mediaRoot = join(root, "quarantine-media");
  const journalFile = join(root, "journals", "latest.journal"),
    anchorsRoot = join(root, "anchors");
  const capture = async () =>
    await captureBundle({
      pool: source.pool,
      storage,
      root: bundleRoot,
      source: "synthetic-source",
      writersStopped: true,
      dump: async (snapshot, path, signal) => {
        await writeFile(
          path,
          await pg(
            "pg_dump",
            sourceName,
            [
              "--format=custom",
              "--no-owner",
              "--no-acl",
              "--snapshot",
              snapshot,
            ],
            signal,
          ),
          { mode: 0o600, flag: "wx" },
        );
      },
    });
  const restore: RestoreQuarantineOptions = {
    pool: target.pool,
    controlPool: admin.pool,
    bundleRoot,
    mediaRoot,
    journalFile,
    anchorsRoot,
    keyFile,
    targetIsolated: true,
    restore: async (path, signal) => {
      await pg(
        "pg_restore",
        targetName,
        ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"],
        signal,
        await readFile(path),
      );
    },
  };
  return {
    admin,
    source,
    target,
    sourceName,
    targetName,
    root,
    storage,
    capture,
    restore,
    journalFile,
    anchorsRoot,
    keyFile,
    dbUrl,
  };
}
async function seed(ctx: Awaited<ReturnType<typeof setup>>) {
  for (const user of ["alice", "bob", "charlie"]) {
    await ctx.source.pool.query(
      'insert into "user"(id,name,email,two_factor_enabled) values($1,$1,$2,true)',
      [user, `${user}@example.test`],
    );
    await ctx.source.pool.query(
      "insert into user_policy(user_id,admitted,role) values($1,true,'admin')",
      [user],
    );
    await ctx.source.pool.query("insert into admission(email) values($1)", [
      `${user}@example.test`,
    ]);
    await ctx.source.pool.query(
      "insert into account(id,account_id,provider_id,user_id,password,access_token,refresh_token,id_token,updated_at) values($1,$1,'credential',$1,'synthetic-password','synthetic-access','synthetic-refresh','synthetic-id',now())",
      [user],
    );
    await ctx.source.pool.query(
      "insert into two_factor(id,user_id,secret,backup_codes) values($1,$1,'synthetic-secret','synthetic-codes')",
      [user],
    );
  }
  await ctx.source.pool.query(
    "insert into session(id,token,user_id,expires_at,updated_at) values('session','synthetic-token','alice',now()+interval '1 day',now())",
  );
  await ctx.source.pool.query(
    "insert into session_security(session_id,authenticated_at,used_at,reauthenticated_at) values('session',now(),now(),now())",
  );
  await ctx.source.pool.query(
    "insert into verification(id,identifier,value,expires_at) values('verify','synthetic','synthetic',now()+interval '1 day')",
  );
  await ctx.source.pool.query(
    "insert into data_export(id,owner_id,state,archive) values('export','alice','ready',$1)",
    [Buffer.from("synthetic-export")],
  );
  const ids = Array.from({ length: 5 }, () => randomUUID());
  for (const [i, id] of ids.entries()) {
    const owner = i === 4 ? "charlie" : "alice";
    await ctx.source.pool.query(
      "insert into media(id,owner_id,state,bytes,width,height,original_present,expires_at) values($1,$2,'ready',20,40,40,true,now()+interval '1 day')",
      [id, owner],
    );
    await ctx.source.pool.query(
      "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date,visibility,location_size,location_x,location_y) values($1,$2,$1,$1,'synthetic','Synthetic cat',current_date,'public',500,1,6000)",
      [id, owner],
    );
    for (const key of ["image.webp", "thumb.webp", "original"])
      await ctx.storage.put(
        `${id}/${key}`,
        Buffer.from(`synthetic-${id}-${key}`),
      );
  }
  const friendship = randomUUID();
  await ctx.source.pool.query(
    "insert into friendship(id,low_id,high_id,sender_id) values($1,'alice','bob','alice')",
    [friendship],
  );
  await ctx.source.pool.query(
    "insert into report(id,encounter_id,reporter_id,reason) values('close',$1,'bob','Synthetic reason'),('remove',$2,'bob','Synthetic reason')",
    [ids[0], ids[1]],
  );
  await ctx.source.pool.query(
    "insert into report_consultation(id,report_id,session_id,actor,reason,expires_at) values('consult','close','session','bob','Synthetic consultation',now()+interval '1 day')",
  );
  return { ids, friendship };
}
function journalOptions(
  ctx: Awaited<ReturnType<typeof setup>>,
  manifest: JournalOptions["manifest"],
): JournalOptions {
  return {
    manifest,
    journalFile: ctx.journalFile,
    anchorsRoot: ctx.anchorsRoot,
    keyFile: ctx.keyFile,
  };
}

test("real dump survives source loss; independent journal replays every restriction; quarantine closes all admissions and DB connects", async () =>
  exercise(async (ctx) => {
    const { ids, friendship } = await seed(ctx);
    const manifest = await ctx.capture();
    await ctx.source.pool.query(
      "update user_policy set status='suspended' where user_id='alice'",
    );
    await ctx.source.pool.query(
      "update user_policy set status='withdrawn',role='user' where user_id='bob'",
    );
    await ctx.source.pool.query(
      "update account set password='changed-after-backup' where user_id='bob'",
    );
    await ctx.source.pool.query(
      "update encounter set hidden=true,visibility='private',location_size=null,location_x=null,location_y=null where id=$1",
      [ids[0]],
    );
    await ctx.source.pool.query(
      "update encounter set deleted_at=now() where id=$1",
      [ids[1]],
    );
    await ctx.source.pool.query(
      "update report set closed_at=now(),outcome='private later outcome' where id='close'",
    );
    await ctx.source.pool.query("delete from report where id='remove'");
    await ctx.source.pool.query("delete from friendship where id=$1", [
      friendship,
    ]);
    await ctx.source.pool.query(
      "update user_policy set status='deleting' where user_id='charlie'",
    );
    const options = journalOptions(ctx, manifest);
    const copy = await captureJournalBundle({
      ...options,
      pool: ctx.source.pool,
    });
    const journal = await readJournalBundle(options);
    assert.equal(new Set(journal.events.map((e) => e.code)).size, 12);
    assert.equal(
      (await readFile(ctx.journalFile)).includes(
        Buffer.from("credentials_revoke"),
      ),
      false,
    );
    // Lose the source namespace and DB, retaining only bundle plus independent cut.
    await ctx.source.pool.query(
      "drop schema public cascade; drop schema drizzle cascade",
    );
    await rm(join(ctx.root, "source-media"), { recursive: true });
    const result = await restoreQuarantine(ctx.restore);
    assert.deepEqual(result, {
      quarantined: true,
      admissionsClosed: true,
      databaseConnectionsDisabled: true,
      objects: 6,
      copiedAt: copy.copiedAt,
      copiedThrough: copy.copiedThrough,
      uncopiedAfterCut: "unknown",
    });
    for (const table of [
      "session",
      "session_security",
      "verification",
      "data_export",
      "report_consultation",
    ])
      assert.equal(
        (await ctx.target.pool.query(`select count(*)::int n from ${table}`))
          .rows[0].n,
        0,
      );
    assert.deepEqual(
      (
        await ctx.target.pool.query(
          "select user_id,status,role,admitted,recovery_pending from user_policy order by user_id",
        )
      ).rows,
      [
        {
          user_id: "alice",
          status: "suspended",
          role: "admin",
          admitted: false,
          recovery_pending: false,
        },
        {
          user_id: "bob",
          status: "withdrawn",
          role: "user",
          admitted: false,
          recovery_pending: true,
        },
      ],
    );
    assert.equal(
      (
        await ctx.target.pool.query(
          "select count(*)::int n from \"user\" where id='charlie'",
        )
      ).rows[0].n,
      0,
    );
    const encounter = (
      await ctx.target.pool.query(
        "select hidden,visibility,location_size,location_x,location_y,location_context from encounter where id=$1",
        [ids[0]],
      )
    ).rows[0];
    assert.deepEqual(encounter, {
      hidden: true,
      visibility: "private",
      location_size: null,
      location_x: null,
      location_y: null,
      location_context: null,
    });
    assert.equal(
      (await ctx.target.pool.query("select count(*)::int n from encounter"))
        .rows[0].n,
      3,
    );
    assert.equal(
      (
        await ctx.target.pool.query(
          "select count(*)::int n from account where user_id='bob'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await ctx.target.pool.query(
          "select count(*)::int n from two_factor where user_id='bob'",
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(
      (
        await ctx.target.pool.query(
          "select password,access_token,refresh_token,id_token from account where user_id='alice'",
        )
      ).rows[0],
      {
        password: "synthetic-password",
        access_token: null,
        refresh_token: null,
        id_token: null,
      },
    );
    assert.equal(
      (
        await ctx.target.pool.query(
          "select count(*)::int n from two_factor where user_id='alice'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await ctx.target.pool.query(
          "select count(*)::int n from admission where active",
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(
      (await ctx.target.pool.query("select id,outcome from report order by id"))
        .rows,
      [{ id: "close", outcome: null }],
    );
    assert.equal(
      (
        await ctx.target.pool.query(
          "select closed_at is not null closed from report where id='close'",
        )
      ).rows[0].closed,
      true,
    );
    assert.equal(
      (await ctx.target.pool.query("select count(*)::int n from friendship"))
        .rows[0].n,
      0,
    );
    const restored = new LocalStorage(ctx.restore.mediaRoot);
    for (const id of [ids[0], ids[2], ids[3]])
      for (const suffix of ["image.webp", "thumb.webp"])
        assert.equal(
          (await restored.get(`${id}/${suffix}`)).toString(),
          `synthetic-${id}-${suffix}`,
        );
    for (const id of ids)
      await assert.rejects(restored.get(`${id}/original`), { code: "ENOENT" });
    for (const id of [ids[1], ids[4]])
      await assert.rejects(restored.get(`${id}/image.webp`), {
        code: "ENOENT",
      });
    assert.equal(
      (
        await ctx.admin.pool.query(
          "select datallowconn from pg_database where datname=$1",
          [ctx.targetName],
        )
      ).rows[0].datallowconn,
      false,
    );
    const fresh = createDatabase(ctx.dbUrl(ctx.targetName));
    try {
      await assert.rejects(fresh.pool.query("select 1"), { code: "55000" });
    } finally {
      await closePool(fresh.pool);
    }
  }));

test("missing anchor, corrupt ciphertext, wrong key, wrong source, floor gaps and old cut rollback are rejected", async () =>
  exercise(async (ctx) => {
    await seed(ctx);
    const manifest = await ctx.capture(),
      options = journalOptions(ctx, manifest);
    await assert.rejects(restoreQuarantine(ctx.restore));
    await captureJournalBundle({ ...options, pool: ctx.source.pool });
    const ciphertext = await readFile(ctx.journalFile),
      key = await readFile(ctx.keyFile);
    const corrupted = Buffer.from(ciphertext);
    corrupted[corrupted.length - 1] ^= 1;
    await writeFile(ctx.journalFile, corrupted);
    await assert.rejects(readJournalBundle(options));
    await writeFile(ctx.journalFile, ciphertext);
    await writeFile(ctx.keyFile, randomBytes(32));
    await assert.rejects(readJournalBundle(options));
    await writeFile(ctx.keyFile, key);
    await chmod(ctx.keyFile, 0o644);
    await assert.rejects(readJournalBundle(options));
    await chmod(ctx.keyFile, 0o600);
    await assert.rejects(
      readJournalBundle({
        ...options,
        manifest: {
          ...manifest,
          journal: { ...manifest.journal, sourceId: randomUUID() },
        },
      }),
    );
    await ctx.source.pool.query(
      "update user_policy set status='suspended' where user_id='alice'",
    );
    const nextOptions = {
      ...options,
      journalFile: join(ctx.root, "journals", "next.journal"),
    };
    await captureJournalBundle({ ...nextOptions, pool: ctx.source.pool });
    await assert.rejects(readJournalBundle(options));
    await ctx.source.pool.query("update recovery_state set floor=head");
    await assert.rejects(
      captureJournalBundle({
        ...options,
        journalFile: join(ctx.root, "journals", "gap.journal"),
        pool: ctx.source.pool,
      }),
    );
    await assert.rejects(lstat(ctx.restore.mediaRoot), { code: "ENOENT" });
    assert.equal(
      (
        await ctx.target.pool.query(
          "select count(*)::int n from information_schema.tables where table_schema='public'",
        )
      ).rows[0].n,
      0,
    );
  }));

test("occupied target, absent isolation assertion and tampered photo refuse before callback; partial restore failure disables DB and cleans media", async () =>
  exercise(async (ctx) => {
    const { ids } = await seed(ctx);
    const manifest = await ctx.capture();
    await captureJournalBundle({
      ...journalOptions(ctx, manifest),
      pool: ctx.source.pool,
    });
    let restored = false;
    const never = async () => {
      restored = true;
    };
    await assert.rejects(
      restoreQuarantine({
        ...ctx.restore,
        targetIsolated: false,
        restore: never,
      } as unknown as RestoreQuarantineOptions),
    );
    await ctx.target.pool.query("create table sentinel(value text)");
    await assert.rejects(restoreQuarantine({ ...ctx.restore, restore: never }));
    assert.equal(restored, false);
    await ctx.target.pool.query("drop table sentinel");
    const photo = join(ctx.restore.bundleRoot, `${ids[0]}/image.webp`),
      bytes = await readFile(photo);
    await writeFile(photo, Buffer.from("corrupt"));
    await assert.rejects(restoreQuarantine({ ...ctx.restore, restore: never }));
    assert.equal(restored, false);
    await writeFile(photo, bytes);
    await assert.rejects(
      restoreQuarantine({
        ...ctx.restore,
        restore: async () => {
          await ctx.target.pool.query(
            "create table partial_restore(value text)",
          );
          throw new Error("sensitive-child-error");
        },
      }),
      /^Error: Quarantine restore failed$/,
    );
    assert.equal(
      (
        await ctx.admin.pool.query(
          "select datallowconn from pg_database where datname=$1",
          [ctx.targetName],
        )
      ).rows[0].datallowconn,
      false,
    );
    await assert.rejects(lstat(ctx.restore.mediaRoot), { code: "ENOENT" });
  }));

test("authenticated retained cut remains usable after a day; expires after retention; coordinated manifest change is rejected", async () =>
  exercise(async (ctx) => {
    await seed(ctx);
    const manifest = await ctx.capture(),
      options = journalOptions(ctx, manifest);
    await captureJournalBundle({ ...options, pool: ctx.source.pool });
    const now = Date.now;
    try {
      Date.now = () => now() + 86400000;
      assert.equal((await readJournalBundle(options)).backupId, manifest.id);
      Date.now = () => now() + 31 * 86400000;
      await assert.rejects(readJournalBundle(options));
    } finally {
      Date.now = now;
    }
    await assert.rejects(
      readJournalBundle({
        ...options,
        manifest: { ...manifest, source: "different-source" },
      }),
    );
    await ctx.source.pool.query(
      "update user_policy set status='suspended' where user_id='alice'",
    );
    await ctx.source.pool.query(
      "delete from recovery_decision where seq=(select head from recovery_state)",
    );
    await assert.rejects(
      captureJournalBundle({
        ...options,
        journalFile: join(ctx.root, "journals", "gapped.journal"),
        pool: ctx.source.pool,
      }),
    );
  }));

test("quarantine rejects remote target or mismatched control URL and preserves occupied media namespace", async () =>
  exercise(async (ctx) => {
    await seed(ctx);
    const manifest = await ctx.capture();
    await captureJournalBundle({
      ...journalOptions(ctx, manifest),
      pool: ctx.source.pool,
    });
    const remote = createDatabase(
      "postgresql://synthetic:synthetic@example.test/not_local_quarantine",
    );
    try {
      await assert.rejects(
        restoreQuarantine({ ...ctx.restore, pool: remote.pool }),
      );
    } finally {
      await closePool(remote.pool);
    }
    await assert.rejects(
      restoreQuarantine({ ...ctx.restore, controlPool: ctx.target.pool }),
    );
    await mkdir(ctx.restore.mediaRoot, { mode: 0o700 });
    const sentinel = join(ctx.restore.mediaRoot, "sentinel");
    await writeFile(sentinel, "keep", { mode: 0o600 });
    await assert.rejects(restoreQuarantine(ctx.restore));
    assert.equal(await readFile(sentinel, "utf8"), "keep");
    assert.equal(
      (
        await ctx.admin.pool.query(
          "select datallowconn from pg_database where datname=$1",
          [ctx.targetName],
        )
      ).rows[0].datallowconn,
      true,
    );
  }));
