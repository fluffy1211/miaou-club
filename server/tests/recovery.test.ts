import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { migrateDatabase } from "../src/infrastructure/db/migrations.js";
import {
  captureBackup,
  captureDecisions,
  restoreBackup,
  seal,
  unseal,
  assertLocalTestDatabase,
  RecoveryStorage,
} from "../src/ops/recovery.js";
import { LocalStorage } from "../src/encounters/storage.js";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test";
assertLocalTestDatabase(url);
async function exercise(
  run: (
    source: ReturnType<typeof createDatabase>,
    target: ReturnType<typeof createDatabase>,
    objects: LocalStorage,
    restored: RecoveryStorage,
  ) => Promise<void>,
) {
  const admin = createDatabase(url);
  const names = [
    "recovery_" + randomUUID().replaceAll("-", "") + "_test",
    "recovery_" + randomUUID().replaceAll("-", "") + "_test",
  ];
  const databases: ReturnType<typeof createDatabase>[] = [];
  await mkdir(".cache", { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(process.cwd(), ".cache", "miaou-recovery-"));
  try {
    for (const name of names) {
      await admin.pool.query(`create database "${name}"`);
      const target = new URL(url);
      target.pathname = name;
      const db = createDatabase(target.href);
      databases.push(db);
      await migrateDatabase(db.pool, "server/drizzle");
    }
    await run(
      databases[0],
      databases[1],
      new LocalStorage(join(root, "source")),
      new RecoveryStorage(join(root, "restored")),
    );
  } finally {
    for (const db of databases) await closePool(db.pool);
    for (const name of names)
      await admin.pool.query(`drop database if exists "${name}" with(force)`);
    await closePool(admin.pool);
    await rm(root, { recursive: true, force: true });
  }
}
async function seed(
  db: ReturnType<typeof createDatabase>,
  storage: LocalStorage,
) {
  await db.pool.query(
    `insert into "user"(id,name,email) values('alice','Synthetic Alice','alice@example.test'),('bob','Synthetic Bob','bob@example.test')`,
  );
  await db.pool.query(
    `insert into user_policy(user_id,admitted) values('alice',true),('bob',true)`,
  );
  await db.pool.query(
    `insert into admission(email) values('alice@example.test'),('bob@example.test')`,
  );
  await db.pool.query(
    `insert into session(id,token,user_id,expires_at,updated_at) values('old-session','synthetic-token','alice',now()+interval '1 day',now())`,
  );
  await db.pool.query(
    `insert into verification(id,identifier,value,expires_at) values('old-link','synthetic-reset','alice',now()+interval '1 day')`,
  );
  await db.pool.query(
    `insert into data_export(id,owner_id,state,archive,expires_at) values('old-export','alice','ready',$1,now()+interval '1 day')`,
    [Buffer.from("synthetic-export")],
  );
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) {
    await db.pool.query(
      `insert into media(id,owner_id,state,bytes,width,height,original_present,expires_at) values($1,$2,'ready',20,40,40,false,now()+interval '1 day')`,
      [id, index === 3 ? "bob" : "alice"],
    );
    await db.pool.query(
      `insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date,location_size,location_x,location_y) values($1,$2,$1,$1,'synthetic','Synthetic cat',current_date,500,1,6000)`,
      [id, index === 3 ? "bob" : "alice"],
    );
    await storage.put(id + "/image.webp", Buffer.from("synthetic-image"));
    await storage.put(id + "/thumb.webp", Buffer.from("synthetic-thumb"));
    await storage.put(
      id + "/original",
      Buffer.from("synthetic-original-with-exif"),
    );
  }
  const friendship = randomUUID();
  await db.pool.query(
    `insert into friendship(id,low_id,high_id,sender_id) values($1,'alice','bob','alice')`,
    [friendship],
  );
  return { ids, friendship };
}
test("recovery refuses remote and non-test databases; authenticated encryption rejects corruption and wrong keys", () => {
  for (const target of [
    "postgresql://x:x@127.0.0.1/miaou_dev",
    "postgresql://x:x@example.test/a_test",
    "postgresql://x:x@localhost/a_test?host=example.test",
  ])
    assert.throws(() => assertLocalTestDatabase(target));
  const key = randomBytes(32),
    encrypted = seal({ secret: "synthetic" }, key);
  assert.ok(!encrypted.includes(Buffer.from("synthetic")));
  assert.deepEqual(unseal(encrypted, key), { secret: "synthetic" });
  assert.throws(() => unseal(encrypted, randomBytes(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => unseal(encrypted, key));
});
test("restoration replays later deletion, masking, suspension, privacy, location and friendship removal; revokes credentials", async () =>
  exercise(async (source, target, objects, restored) => {
    const { ids, friendship } = await seed(source, objects);
    const key = randomBytes(32);
    const backup = await captureBackup(source.pool, objects);
    assert.ok(
      Object.keys(backup.objects).every((k) => !k.endsWith("/original")),
    );
    const encrypted = seal(backup, key);
    await source.pool.query(
      "update encounter set deleted_at=now() where id=$1",
      [ids[0]],
    );
    await source.pool.query("update encounter set hidden=true where id=$1", [
      ids[1],
    ]);
    await source.pool.query(
      "update encounter set visibility='private',location_size=null,location_x=null,location_y=null,location_context=null where id=$1",
      [ids[2]],
    );
    await source.pool.query(
      "update user_policy set status='suspended' where user_id='bob'",
    );
    await source.pool.query("delete from friendship where id=$1", [friendship]);
    const decisions = await captureDecisions(source.pool, backup);
    assert.ok(!JSON.stringify(decisions).includes("Synthetic cat"));
    await restoreBackup(
      target.pool,
      restored,
      unseal(encrypted, key),
      decisions,
    );
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from encounter where id=$1",
          [ids[0]],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await target.pool.query("select hidden from encounter where id=$1", [
          ids[1],
        ])
      ).rows[0].hidden,
      true,
    );
    assert.deepEqual(
      (
        await target.pool.query(
          "select visibility,location_size,location_context from encounter where id=$1",
          [ids[2]],
        )
      ).rows[0],
      { visibility: "private", location_size: null, location_context: null },
    );
    assert.equal(
      (
        await target.pool.query(
          "select status from user_policy where user_id='bob'",
        )
      ).rows[0].status,
      "suspended",
    );
    for (const table of [
      "session",
      "verification",
      "data_export",
      "friendship",
    ])
      assert.equal(
        (await target.pool.query(`select count(*)::int n from ${table}`))
          .rows[0].n,
        0,
      );
    assert.deepEqual(
      await restored.get(ids[2] + "/image.webp"),
      Buffer.from("synthetic-image"),
    );
    await assert.rejects(restored.get(ids[0] + "/image.webp"));
    await assert.rejects(restored.get(ids[2] + "/original"));
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from admission where active",
        )
      ).rows[0].n,
      0,
    );
  }));
test("physically purged users and encounters never reappear", async () =>
  exercise(async (source, target, objects, restored) => {
    const { ids } = await seed(source, objects),
      backup = await captureBackup(source.pool, objects);
    await source.pool.query("delete from encounter where owner_id='bob'");
    await source.pool.query("delete from media where owner_id='bob'");
    await source.pool.query(`delete from "user" where id='bob'`);
    const decisions = await captureDecisions(source.pool, backup);
    await restoreBackup(target.pool, restored, backup, decisions);
    assert.equal(
      (
        await target.pool.query(
          `select count(*)::int n from "user" where id='bob'`,
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(restored.get(ids[3] + "/image.webp"));
  }));
test("missing photos, unrelated/stale decisions and occupied targets stop recovery", async () =>
  exercise(async (source, target, objects, restored) => {
    const { ids } = await seed(source, objects);
    const backup = await captureBackup(source.pool, objects),
      decisions = await captureDecisions(source.pool, backup);
    await assert.rejects(
      restoreBackup(target.pool, restored, backup, {
        ...decisions,
        backupId: randomUUID(),
      }),
    );
    await assert.rejects(
      restoreBackup(target.pool, restored, backup, {
        ...decisions,
        capturedAt: "2000-01-01T00:00:00Z",
      }),
    );
    await assert.rejects(
      restoreBackup(
        target.pool,
        restored,
        { ...backup, schema: "0".repeat(64) },
        decisions,
      ),
    );
    await assert.rejects(
      restoreBackup(
        target.pool,
        restored,
        { ...backup, capturedAt: "2000-01-01T00:00:00Z" },
        decisions,
      ),
    );
    const missing = structuredClone(backup);
    delete missing.objects[ids[0] + "/image.webp"];
    await assert.rejects(
      restoreBackup(target.pool, restored, missing, decisions),
    );
    assert.equal(
      (await target.pool.query('select count(*)::int n from "user"')).rows[0].n,
      0,
    );
    await target.pool.query(
      `insert into "user"(id,name,email) values('existing','Synthetic','existing@example.test')`,
    );
    await assert.rejects(
      restoreBackup(target.pool, restored, backup, decisions),
    );
    assert.equal(
      (await target.pool.query(`select count(*)::int n from "user"`)).rows[0].n,
      1,
    );
    await objects.remove([ids[0] + "/thumb.webp"]);
    await assert.rejects(captureBackup(source.pool, objects));
  }));
test("storage failure rolls DB restoration back and permits a retry", async () =>
  exercise(async (source, target, objects, restored) => {
    await seed(source, objects);
    const backup = await captureBackup(source.pool, objects),
      decisions = await captureDecisions(source.pool, backup);
    const put = restored.put.bind(restored);
    let written = 0;
    restored.put = async (key, bytes) => {
      if (++written === 2) throw new Error("synthetic failure");
      await put(key, bytes);
    };
    await assert.rejects(
      restoreBackup(target.pool, restored, backup, decisions),
    );
    restored.put = put;
    assert.equal(
      (await target.pool.query(`select count(*)::int n from "user"`)).rows[0].n,
      0,
    );
    await restoreBackup(target.pool, restored, backup, decisions);
    assert.equal(
      (await target.pool.query(`select count(*)::int n from "user"`)).rows[0].n,
      2,
    );
  }));
test("migration runner serializes concurrent initial migrations and remains idempotent", async () => {
  const admin = createDatabase(url),
    name = "migration_" + randomUUID().replaceAll("-", "") + "_test";
  await admin.pool.query(`create database "${name}"`);
  const target = new URL(url);
  target.pathname = name;
  const db = createDatabase(target.href);
  try {
    await Promise.all([
      migrateDatabase(db.pool, "server/drizzle"),
      migrateDatabase(db.pool, "server/drizzle"),
    ]);
    const count = (
      await db.pool.query(
        "select count(*)::int n from drizzle.__drizzle_migrations",
      )
    ).rows[0].n;
    await migrateDatabase(db.pool, "server/drizzle");
    assert.equal(
      (
        await db.pool.query(
          "select count(*)::int n from drizzle.__drizzle_migrations",
        )
      ).rows[0].n,
      count,
    );
    assert.equal(count, 12);
    await assert.rejects(
      migrateDatabase(db.pool, "server/nonexistent-migrations"),
    );
    assert.equal(
      (
        await db.pool.query(
          "select count(*)::int n from pg_locks where locktype='advisory' and classid=1296646485 and objid=6 and database=(select oid from pg_database where datname=current_database())",
        )
      ).rows[0].n,
      0,
    );
    await migrateDatabase(db.pool, "server/drizzle");
  } finally {
    await closePool(db.pool);
    await admin.pool.query(`drop database "${name}" with(force)`);
    await closePool(admin.pool);
  }
});

test("occupied object namespaces cannot be overwritten; newer credentials and role demotion are respected", async () =>
  exercise(async (source, target, objects, restored) => {
    const { ids } = await seed(source, objects);
    await source.pool.query(
      "update user_policy set role='admin' where user_id='alice'",
    );
    await source.pool.query(
      `insert into account(id,account_id,provider_id,user_id,password,updated_at) values('credential','alice','credential','alice','synthetic-old-hash',now())`,
    );
    const backup = await captureBackup(source.pool, objects);
    await source.pool.query(
      "update account set password='synthetic-new-hash' where user_id='alice'",
    );
    await source.pool.query(
      "update user_policy set role='user' where user_id='alice'",
    );
    const decisions = await captureDecisions(source.pool, backup);
    await restored.put(ids[0] + "/image.webp", Buffer.from("existing-object"));
    await assert.rejects(
      restoreBackup(target.pool, restored, backup, decisions),
    );
    assert.deepEqual(
      await restored.get(ids[0] + "/image.webp"),
      Buffer.from("existing-object"),
    );
    await restored.remove([ids[0] + "/image.webp"]);
    await restoreBackup(target.pool, restored, backup, decisions);
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from account where user_id='alice'",
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(
      (
        await target.pool.query(
          "select role,recovery_pending from user_policy where user_id='alice'",
        )
      ).rows[0],
      { role: "user", recovery_pending: true },
    );
  }));

test("CLI writes independent encrypted archives, refuses overwrites and restores only a closed synthetic target", async () =>
  exercise(async (source, target) => {
    const root = await mkdtemp(join(process.cwd(), ".cache", "recovery-cli-"));
    try {
      const sourceDir = join(root, "source"),
        targetDir = join(root, "target");
      const keyFile = join(root, "backup.key"),
        decisionKeyFile = join(root, "decisions.key");
      const backupFile = join(root, "backup.enc"),
        decisionsFile = join(root, "decisions.enc");
      await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
      await writeFile(decisionKeyFile, randomBytes(32), { mode: 0o600 });
      const objects = new LocalStorage(sourceDir);
      const { ids } = await seed(source, objects);
      const command = promisify(execFile);
      const env = {
        ...process.env,
        MIAOU_SYNTHETIC_RECOVERY: "1",
        MIAOU_RECOVERY_KEY_FILE: keyFile,
        MIAOU_DECISIONS_KEY_FILE: decisionKeyFile,
      };
      const invoke = (
        action: string,
        database: string,
        mediaRoot: string,
        changes = {},
      ) =>
        command(
          process.execPath,
          [
            "--import",
            "tsx",
            "server/src/ops/recovery-cli.ts",
            action,
            backupFile,
            decisionsFile,
          ],
          {
            env: {
              ...env,
              TEST_DATABASE_URL: database,
              MIAOU_LOCAL_MEDIA_DIR: mediaRoot,
              ...changes,
            },
          },
        );
      const sourceURL = source.pool.options.connectionString!,
        targetURL = target.pool.options.connectionString!;
      await invoke("backup", sourceURL, sourceDir);
      assert.equal((await stat(backupFile)).mode & 0o077, 0);
      assert.ok(
        !(await readFile(backupFile)).includes(Buffer.from("Synthetic cat")),
      );
      await assert.rejects(invoke("backup", sourceURL, sourceDir));
      await source.pool.query("update encounter set hidden=true where id=$1", [
        ids[0],
      ]);
      await invoke("decisions", sourceURL, sourceDir);
      await assert.rejects(
        invoke("restore", targetURL, targetDir, {
          MIAOU_SYNTHETIC_RECOVERY: "0",
        }),
      );
      await assert.rejects(
        invoke("restore", targetURL, targetDir, {
          MIAOU_DECISIONS_KEY_FILE: keyFile,
        }),
      );
      const result = await invoke("restore", targetURL, targetDir);
      assert.equal(JSON.parse(result.stdout).code, "restored_closed");
      assert.equal(
        (
          await target.pool.query("select hidden from encounter where id=$1", [
            ids[0],
          ])
        ).rows[0].hidden,
        true,
      );
      await assert.rejects(invoke("restore", targetURL, targetDir));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }));
