import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  copyJournal,
  readJournal,
  restoreJournal,
  writeJournalFile,
} from "../src/ops/decision-journal.js";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  stat,
  cp,
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
    root: string,
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
      root,
    );
  } finally {
    for (const db of databases) if (!db.pool.ending) await closePool(db.pool);
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
    assert.equal(count, 14);
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

test("closed and purged reports cannot reopen after restoration, without copying outcome text", async () =>
  exercise(async (source, target, objects, restored) => {
    const { ids } = await seed(source, objects);
    await source.pool.query(
      "insert into report(id,encounter_id,reporter_id,reason) values('closed-later',$1,'bob','Synthetic reason'),('purged-later',$2,'bob','Synthetic reason')",
      [ids[0], ids[1]],
    );
    await source.pool.query(
      "insert into report(id,encounter_id,reporter_id,reason,closed_at,outcome) values('already-closed',$1,'bob','Synthetic reason',now(),'Saved outcome')",
      [ids[2]],
    );
    const backup = await captureBackup(source.pool, objects);
    await source.pool.query(
      "update report set closed_at=now(),outcome='Synthetic private outcome' where id='closed-later'",
    );
    await source.pool.query("delete from report where id='purged-later'");
    const decisions = await captureDecisions(source.pool, backup);
    assert.ok(!JSON.stringify(decisions).includes("Synthetic private outcome"));
    await restoreBackup(target.pool, restored, backup, decisions);
    const reports = (
      await target.pool.query(
        "select id,closed_at,outcome from report order by id",
      )
    ).rows;
    assert.equal(reports.length, 2);
    assert.equal(reports[0].id, "already-closed");
    assert.ok(reports[0].closed_at);
    assert.equal(reports[0].outcome, "Saved outcome");
    assert.equal(reports[1].id, "closed-later");
    assert.ok(reports[1].closed_at);
    assert.equal(reports[1].outcome, null);
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from report where closed_at is null",
        )
      ).rows[0].n,
      0,
    );
  }));

test("transactional journal rolls back, serializes concurrent commits without holes and blocks TRUNCATE", async () =>
  exercise(async (source) => {
    await source.pool.query(
      `insert into "user"(id,name,email) values('alice','Synthetic Alice','alice@example.test'),('bob','Synthetic Bob','bob@example.test')`,
    );
    await source.pool.query(
      "insert into user_policy(user_id) values('alice'),('bob')",
    );
    const initial = BigInt(
      (await source.pool.query("select head::text from recovery_state")).rows[0]
        .head,
    );
    const first = await source.pool.connect(),
      second = await source.pool.connect();
    try {
      await first.query("begin");
      await first.query(
        "update user_policy set status='suspended' where user_id='alice'",
      );
      assert.equal(
        (await source.pool.query("select head::text from recovery_state"))
          .rows[0].head,
        String(initial),
      );
      const waiting = second.query(
        "update user_policy set status='withdrawn' where user_id='bob'",
      );
      await first.query("rollback");
      await waiting;
      assert.deepEqual(
        (
          await source.pool.query(
            "select seq::text,code,subject from recovery_decision where seq>$1 order by seq",
            [String(initial)],
          )
        ).rows,
        [{ seq: String(initial + 1n), code: "user_withdraw", subject: "bob" }],
      );
      await first.query("begin");
      await first.query(
        "update user_policy set status='suspended' where user_id='alice'",
      );
      const next = second.query(
        "update user_policy set status='suspended' where user_id='bob'",
      );
      await first.query("commit");
      await next;
      assert.deepEqual(
        (
          await source.pool.query(
            "select seq::text,subject from recovery_decision where seq>$1 order by seq",
            [String(initial + 1n)],
          )
        ).rows,
        [
          { seq: String(initial + 2n), subject: "alice" },
          { seq: String(initial + 3n), subject: "bob" },
        ],
      );
      await assert.rejects(
        source.pool.query('truncate "user" cascade'),
        /TRUNCATE bypasses/,
      );
      assert.equal(
        (await source.pool.query("select head::text from recovery_state"))
          .rows[0].head,
        String(initial + 3n),
      );
    } finally {
      first.release();
      second.release();
    }
  }));

test("journal copy is exclusive, encrypted, private and retryable; latest separate anchor rejects old, corrupt, unlinked and gapped copies", async () =>
  exercise(async (source, _target, objects, _restored, root) => {
    const { ids } = await seed(source, objects),
      b = await captureBackup(source.pool, objects),
      key = randomBytes(32);
    const anchors = join(root, "anchors"),
      old = join(root, "copies", "first.enc"),
      latest = join(root, "copies", "latest.enc");
    await source.pool.query("update encounter set hidden=true where id=$1", [
      ids[0],
    ]);
    await copyJournal(source.pool, b, old, anchors, key);
    const bytes = await readFile(old);
    assert.equal((await stat(old)).mode & 0o077, 0);
    assert.ok(!bytes.includes(Buffer.from("encounter_hide")));
    await assert.rejects(copyJournal(source.pool, b, old, anchors, key));
    assert.deepEqual(await readFile(old), bytes);
    await source.pool.query(
      "update encounter set visibility='private' where id=$1",
      [ids[1]],
    );
    const occupied = join(root, "copies", "occupied.enc");
    await writeFile(occupied, Buffer.from("existing"), { mode: 0o600 });
    await assert.rejects(copyJournal(source.pool, b, occupied, anchors, key));
    assert.equal((await readFile(occupied)).toString(), "existing");
    let writes = 0;
    await assert.rejects(
      copyJournal(source.pool, b, latest, anchors, key, async (path, bytes) => {
        if (++writes === 2) throw new Error("Synthetic anchor disk failure");
        await writeJournalFile(path, bytes);
      }),
      /anchor disk failure/,
    );
    await assert.rejects(readFile(latest));
    assert.deepEqual(await readFile(old), bytes);
    assert.equal((await readJournal(b, old, anchors, key)).events.length, 1);
    await copyJournal(source.pool, b, latest, anchors, key);
    await assert.rejects(
      readJournal(b, old, anchors, key),
      /Latest independent/,
    );
    const c = await readJournal(b, latest, anchors, key);
    assert.equal(c.events.length, 2);
    assert.deepEqual(
      c.events.map((e) => e.code),
      ["encounter_hide", "encounter_private"],
    );
    await assert.rejects(readJournal(b, latest, anchors, randomBytes(32)));
    await assert.rejects(
      readJournal({ ...b, id: randomUUID() }, latest, anchors, key),
    );
    await assert.rejects(
      readJournal(
        { ...b, journal: { ...b.journal, sourceId: randomUUID() } },
        latest,
        anchors,
        key,
      ),
    );
    const anchorFile = join(anchors, `${b.id}.${c.end}.anchor`),
      anchorBytes = await readFile(anchorFile),
      archive = await readFile(latest);
    assert.equal((await stat(anchorFile)).mode & 0o077, 0);
    await writeFile(latest, archive.subarray(0, archive.length - 4));
    await assert.rejects(readJournal(b, latest, anchors, key));
    const corrupt = Buffer.from(archive);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(latest, corrupt);
    await assert.rejects(readJournal(b, latest, anchors, key));
    const a = unseal<Record<string, unknown>>(anchorBytes, key);
    async function invalid(value: unknown, match: RegExp) {
      const encrypted = seal(value, key);
      await writeFile(latest, encrypted);
      await writeFile(
        anchorFile,
        seal(
          {
            ...a,
            digest: createHash("sha256").update(encrypted).digest("hex"),
          },
          key,
        ),
      );
      await assert.rejects(readJournal(b, latest, anchors, key), match);
    }
    await invalid({ ...c, events: c.events.slice(1) }, /gapped/);
    await invalid({ ...c, events: c.events.slice(0, 1) }, /Incomplete/);
    await invalid({ ...c, copiedAt: "2000-01-01T00:00:00Z" }, /linkage/);
    await invalid(
      { ...c, events: [{ ...c.events[0], coordinates: [1, 2] }, c.events[1]] },
      /gapped/,
    );
    await writeFile(latest, archive);
    await writeFile(anchorFile, anchorBytes);
    await assert.rejects(
      readJournal(
        { ...b, capturedAt: "2000-01-01T00:00:00Z" },
        latest,
        anchors,
        key,
      ),
      /Retained backup/,
    );
    await assert.rejects(
      copyJournal(
        source.pool,
        { ...b, journal: { ...b.journal, sourceId: randomUUID() } },
        join(root, "copies", "other.enc"),
        anchors,
        key,
      ),
      /source journal/,
    );
    await assert.rejects(
      writeJournalFile(join(root, "copies", "partial.enc"), undefined as never),
    );
    await assert.rejects(readFile(join(root, "copies", "partial.enc")));
    await source.pool.query("delete from recovery_decision where seq=$1", [
      c.events[0].seq,
    ]);
    await assert.rejects(
      copyJournal(
        source.pool,
        b,
        join(root, "copies", "gapped-source.enc"),
        anchors,
        key,
      ),
      /gapped/,
    );
  }));

test("independent journal survives actual source DB and file loss; replay preserves restrictions without new access, texts, locations or credentials", async () =>
  exercise(async (source, target, objects, restored, root) => {
    const { ids, friendship } = await seed(source, objects);
    await source.pool.query(
      `insert into "user"(id,name,email) values('purged','Synthetic Purged','purged@example.test'),('deleting','Synthetic Deleting','deleting@example.test')`,
    );
    await source.pool.query(
      "insert into user_policy(user_id,admitted) values('purged',true),('deleting',true)",
    );
    await source.pool.query(
      "update user_policy set role='admin' where user_id='alice'",
    );
    await source.pool.query(
      `insert into account(id,account_id,provider_id,user_id,password,updated_at) values('credential','alice','credential','alice','synthetic-old-hash',now())`,
    );
    await source.pool.query(
      `insert into two_factor(id,user_id,secret,backup_codes) values('factor','alice','synthetic-totp','synthetic-backup-codes')`,
    );
    await source.pool.query(
      `insert into report(id,encounter_id,reporter_id,reason) values('closed-later',$1,'bob','Synthetic reason'),('purged-later',$2,'bob','Synthetic reason')`,
      [ids[1], ids[2]],
    );
    await source.pool.query(
      `insert into report(id,encounter_id,reporter_id,reason,closed_at,outcome) values('closed-before',$1,'bob','Synthetic reason',now(),'Saved outcome')`,
      [ids[2]],
    );
    const backup = await captureBackup(source.pool, objects),
      key = randomBytes(32),
      file = join(root, "independent-copies", "journal.enc"),
      anchors = join(root, "independent-anchors");
    await source.pool.query(
      "update encounter set deleted_at=now() where id=$1",
      [ids[0]],
    );
    await source.pool.query("update encounter set hidden=true where id=$1", [
      ids[1],
    ]);
    await source.pool.query("update encounter set hidden=false where id=$1", [
      ids[1],
    ]);
    await source.pool.query(
      "update encounter set visibility='private',location_size=1000,location_x=2,location_y=3000 where id=$1",
      [ids[2]],
    );
    await source.pool.query(
      "update encounter set visibility='public' where id=$1",
      [ids[2]],
    );
    await source.pool.query(
      "update user_policy set status='suspended',role='user' where user_id='alice'",
    );
    await source.pool.query(
      "update user_policy set status='active',role='admin' where user_id='alice'",
    );
    await source.pool.query("delete from friendship where id=$1", [friendship]);
    await source.pool.query(
      "update account set password='synthetic-new-hash' where user_id='alice'",
    );
    await source.pool.query(
      "update two_factor set backup_codes='synthetic-consumed-code' where user_id='alice'",
    );
    await source.pool.query(
      "update report set closed_at=now(),outcome='Synthetic private outcome' where id='closed-later'",
    );
    await source.pool.query("delete from report where id='purged-later'");
    await source.pool.query("delete from encounter where owner_id='bob'");
    await source.pool.query("delete from media where owner_id='bob'");
    await source.pool.query(
      "update user_policy set status='withdrawn',admitted=false where user_id='bob'",
    );
    await source.pool.query(
      "update user_policy set status='deleting' where user_id='deleting'",
    );
    await source.pool.query("delete from \"user\" where id='purged'");
    const cut = await copyJournal(source.pool, backup, file, anchors, key),
      copied = await readJournal(backup, file, anchors, key);
    const serialized = JSON.stringify(copied);
    for (const forbidden of [
      "Synthetic",
      "outcome",
      "password",
      "backup_codes",
      "location_x",
      "location_y",
      "example.test",
      "image.webp",
    ])
      assert.ok(!serialized.includes(forbidden), forbidden);
    // A later decision is deliberately NOT copied: it demonstrates the cutoff.
    await source.pool.query(
      "update encounter set deleted_at=now() where id=$1",
      [ids[1]],
    );
    const sourceName = new URL(
      source.pool.options.connectionString!,
    ).pathname.slice(1);
    await closePool(source.pool);
    const admin = createDatabase(url);
    try {
      await admin.pool.query(`drop database "${sourceName}" with(force)`);
      assert.equal(
        (
          await admin.pool.query(
            "select count(*)::int n from pg_database where datname=$1",
            [sourceName],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await closePool(admin.pool);
    }
    await rm(join(root, "source"), { recursive: true });
    await assert.rejects(objects.get(ids[2] + "/image.webp"));
    const result = await restoreJournal(
      target.pool,
      restored,
      backup,
      file,
      anchors,
      key,
    );
    assert.equal(result.copiedThrough, cut.copiedThrough);
    assert.equal(result.uncopiedAfterCut, "unknown");
    assert.deepEqual(
      (
        await target.pool.query(
          "select id,hidden,visibility,location_size from encounter order by id",
        )
      ).rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
      [
        { id: ids[1], hidden: true, visibility: "public", location_size: 500 },
        {
          id: ids[2],
          hidden: false,
          visibility: "private",
          location_size: null,
        },
      ],
    );
    assert.deepEqual(
      (
        await target.pool.query(
          "select status,role,admitted,recovery_pending from user_policy where user_id='alice'",
        )
      ).rows[0],
      {
        status: "suspended",
        role: "user",
        admitted: false,
        recovery_pending: true,
      },
    );
    assert.equal(
      (await target.pool.query('select count(*)::int n from "user"')).rows[0].n,
      2,
    );
    for (const table of [
      "account",
      "two_factor",
      "friendship",
      "session",
      "verification",
      "data_export",
    ])
      assert.equal(
        (await target.pool.query(`select count(*)::int n from ${table}`))
          .rows[0].n,
        0,
      );
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from admission where active",
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(restored.get(ids[0] + "/image.webp"));
    await assert.rejects(restored.get(ids[3] + "/image.webp"));
    assert.deepEqual(
      await restored.get(ids[2] + "/image.webp"),
      Buffer.from("synthetic-image"),
    );
    assert.equal(
      (
        await target.pool.query(
          "select status from user_policy where user_id='bob'",
        )
      ).rows[0].status,
      "withdrawn",
    );
    const reports = (
      await target.pool.query(
        "select id,closed_at,outcome from report order by id",
      )
    ).rows;
    assert.equal(reports.length, 2);
    assert.equal(reports[0].id, "closed-before");
    assert.ok(reports[0].closed_at);
    assert.equal(reports[0].outcome, "Saved outcome");
    assert.equal(reports[1].id, "closed-later");
    assert.ok(reports[1].closed_at);
    assert.equal(reports[1].outcome, null);
  }));

test("journal upgrades from schemas 0011 and 0012 keep content; pruning rejects backups below the retained floor", async () => {
  for (const last of [11, 12]) {
    await mkdir(".cache", { recursive: true, mode: 0o700 });
    const previous = await mkdtemp(
      join(process.cwd(), ".cache", "miaou-journal-upgrade-"),
    );
    try {
      await cp("server/drizzle", previous, { recursive: true });
      if (last === 11)
        await rm(join(previous, "0012_strong_golden_guardian.sql"));
      await rm(join(previous, "0013_recovery_prune_lock.sql"));
      const metadata = JSON.parse(
        await readFile(join(previous, "meta/_journal.json"), "utf8"),
      );
      metadata.entries = metadata.entries.filter(
        (entry: { idx: number }) => entry.idx <= last,
      );
      await writeFile(
        join(previous, "meta/_journal.json"),
        JSON.stringify(metadata),
      );
      const admin = createDatabase(url),
        name = "upgrade_" + randomUUID().replaceAll("-", "") + "_test",
        connection = new URL(url);
      connection.pathname = name;
      await admin.pool.query(`create database "${name}"`);
      const source = createDatabase(connection.href);
      try {
        await migrateDatabase(source.pool, previous);
        await source.pool.query(
          `insert into "user"(id,name,email) values('alice','Synthetic Alice','alice@example.test')`,
        );
        await source.pool.query(
          "insert into user_policy(user_id,admitted) values('alice',true)",
        );
        await migrateDatabase(source.pool, "server/drizzle");
        assert.equal(
          (await source.pool.query("select admitted from user_policy")).rows[0]
            .admitted,
          true,
        );
        assert.equal(
          (await source.pool.query("select head::text from recovery_state"))
            .rows[0].head,
          "0",
        );
        const root = await mkdtemp(
          join(process.cwd(), ".cache", "journal-prune-"),
        );
        try {
          const backup = await captureBackup(
            source.pool,
            new LocalStorage(join(root, "source")),
          );
          await source.pool.query(
            "update user_policy set status='withdrawn' where user_id='alice'",
          );
          await source.pool.query(
            "update recovery_decision set created_at=now()-interval '31 days'",
          );
          await source.pool.query("select recovery_prune()");
          assert.equal(
            (await source.pool.query("select floor::text from recovery_state"))
              .rows[0].floor,
            "1",
          );
          await assert.rejects(
            copyJournal(
              source.pool,
              backup,
              join(root, "copies", "copy.enc"),
              join(root, "anchors"),
              randomBytes(32),
            ),
            /retained source journal/,
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      } finally {
        await closePool(source.pool);
        await admin.pool.query(`drop database "${name}" with(force)`);
        await closePool(admin.pool);
      }
    } finally {
      await rm(previous, { recursive: true, force: true });
    }
  }
});

test("journal CLI copies a durable cut and restores through its independent anchor with admissions closed", async () =>
  exercise(async (source, target, objects, _restored, root) => {
    const { ids } = await seed(source, objects);
    const backupFile = join(root, "backup.enc"),
      journalFile = join(root, "copies", "journal.enc"),
      keyFile = join(root, "backup.key"),
      journalKeyFile = join(root, "journal.key");
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    await writeFile(journalKeyFile, randomBytes(32), { mode: 0o600 });
    const command = promisify(execFile);
    async function invoke(action: string, database: string, media: string) {
      return command(
        process.execPath,
        [
          "--import",
          "tsx",
          "server/src/ops/recovery-cli.ts",
          action,
          backupFile,
          journalFile,
        ],
        {
          env: {
            ...process.env,
            MIAOU_SYNTHETIC_RECOVERY: "1",
            TEST_DATABASE_URL: database,
            MIAOU_LOCAL_MEDIA_DIR: media,
            MIAOU_RECOVERY_KEY_FILE: keyFile,
            MIAOU_DECISIONS_KEY_FILE: journalKeyFile,
            MIAOU_JOURNAL_ANCHOR_DIR: join(root, "anchors"),
          },
        },
      );
    }
    const sourceURL = source.pool.options.connectionString!,
      targetURL = target.pool.options.connectionString!;
    await invoke("backup", sourceURL, join(root, "source"));
    await source.pool.query("update encounter set hidden=true where id=$1", [
      ids[0],
    ]);
    const cut = JSON.parse(
      (await invoke("journal", sourceURL, join(root, "source"))).stdout,
    );
    assert.equal(cut.code, "journal_copied");
    assert.equal(cut.uncopiedAfterCut, "unknown");
    const result = JSON.parse(
      (await invoke("restore-journal", targetURL, join(root, "cli-restored")))
        .stdout,
    );
    assert.equal(result.code, "restored_closed");
    assert.equal(result.copiedThrough, cut.copiedThrough);
    assert.equal(result.admissionsClosed, true);
    assert.equal(
      (
        await target.pool.query("select hidden from encounter where id=$1", [
          ids[0],
        ])
      ).rows[0].hidden,
      true,
    );
  }));

test("journal pruning scans without holding the restriction counter lock", async () =>
  exercise(async (source) => {
    await source.pool.query(`insert into recovery_decision(seq,code,subject)
      select n,'encounter_hide','synthetic-' || n from generate_series(1,20000) n`);
    await source.pool.query("update recovery_state set head=20000");
    const blocker = await source.pool.connect(),
      pruner = await source.pool.connect(),
      writer = await source.pool.connect();
    let pruning: Promise<unknown> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("lock recovery_decision in access exclusive mode");
      const pid = (await pruner.query("select pg_backend_pid() pid")).rows[0]
        .pid;
      pruning = pruner.query("select recovery_prune()");
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (Date.now() < deadline) {
        const row = (
          await source.pool.query(
            "select wait_event_type,wait_event from pg_stat_activity where pid=$1",
            [pid],
          )
        ).rows[0];
        if (row.wait_event_type === "Lock" && row.wait_event === "relation") {
          waiting = true;
          break;
        }
      }
      assert.equal(
        waiting,
        true,
        "pruning must be blocked in the journal scan",
      );
      await writer.query("begin");
      await writer.query(
        "select head from recovery_state where singleton for update nowait",
      );
      await writer.query("rollback");
      await blocker.query("rollback");
      await pruning;
      assert.equal(
        (await source.pool.query("select floor::text from recovery_state"))
          .rows[0].floor,
        "0",
      );
    } finally {
      await writer.query("rollback");
      await blocker.query("rollback");
      if (pruning) await pruning;
      blocker.release();
      pruner.release();
      writer.release();
    }
  }));

test("journal replay restores restrictions across a larger synthetic inventory", async () =>
  exercise(async (source, target, objects, restored, root) => {
    await seed(source, objects);
    await source.pool.query(`insert into "user"(id,name,email)
      select 'synthetic-' || n,'Synthetic Member','synthetic-' || n || '@example.test'
      from generate_series(1,1000) n`);
    await source.pool.query(`insert into user_policy(user_id,admitted)
      select 'synthetic-' || n,true from generate_series(1,1000) n`);
    const backup = await captureBackup(source.pool, objects);
    await source.pool
      .query(`select recovery_record('user_suspend','synthetic-' || (1+(n%1000)))
      from generate_series(1,12000) n`);
    const file = join(root, "copies", "large.enc"),
      anchors = join(root, "anchors"),
      key = randomBytes(32);
    await copyJournal(source.pool, backup, file, anchors, key);
    await restoreJournal(target.pool, restored, backup, file, anchors, key);
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from user_policy where status='suspended' and not admitted",
        )
      ).rows[0].n,
      1000,
    );
    assert.equal(
      (await target.pool.query("select count(*)::int n from session")).rows[0]
        .n,
      0,
    );
  }));

function readRecoveryState(bytes: Buffer, key: Buffer) {
  return unseal<import("../src/ops/recovery-orchestration.js").Catalog>(
    bytes,
    key,
  );
}

test("managed backups detect lag, keep usable cuts on failure, resume and restore after source loss", async () =>
  exercise(async (source, target, objects, restored, root) => {
    const { runRecovery } =
      await import("../src/ops/recovery-orchestration.js");
    const { readdir } = await import("node:fs/promises");
    const { ids } = await seed(source, objects);
    const options = {
      root: join(root, "managed"),
      anchors: join(root, "managed-anchors"),
      backupKey: randomBytes(32),
      journalKey: randomBytes(32),
    };
    assert.equal(
      (await runRecovery(source.pool, objects, "status", options)).code,
      "recovery_attention",
    );
    const created = await runRecovery(source.pool, objects, "backup", options);
    assert.equal(created.code, "recovery_current");
    const id = created.backups[0].id;
    const first = (await readdir(join(options.root, "copies")))[0];
    const initial = await readFile(join(options.root, "copies", first));
    await source.pool.query("update encounter set hidden=true where id=$1", [
      ids[0],
    ]);
    const behind = await runRecovery(source.pool, objects, "status", options);
    assert.equal(behind.code, "recovery_attention");
    assert.equal(behind.backups[0].code, "journal_behind");
    // Actual copy publication succeeds, anchor write fails. Previous cut stays usable.
    await assert.rejects(
      runRecovery(source.pool, objects, "copy", {
        ...options,
        write: async (path, bytes) => {
          if (path.endsWith(".anchor"))
            throw new Error("synthetic anchor failure");
          await writeJournalFile(path, bytes);
        },
      }),
    );
    assert.deepEqual(
      await readFile(join(options.root, "copies", first)),
      initial,
    );
    assert.equal(
      readRecoveryState(
        await readFile(join(options.root, "state.enc")),
        options.backupKey,
      ).last!.code,
      "failed",
    );
    assert.equal(
      (await runRecovery(source.pool, objects, "copy", options)).code,
      "recovery_current",
    );
    assert.equal((await readdir(join(options.root, "copies"))).length, 1);
    assert.equal((await readdir(options.anchors)).length, 1);
    const after = await readFile(join(options.root, "state.enc"));
    await runRecovery(source.pool, objects, "copy", options);
    assert.equal((await readdir(join(options.root, "copies"))).length, 1); // no rewrite with no new decisions
    const catalog = readRecoveryState(after, options.backupKey);
    const value = unseal<import("../src/ops/recovery.js").Backup>(
      await readFile(join(options.root, "backups", id + ".enc")),
      options.backupKey,
    );
    const copy = join(
      options.root,
      "copies",
      id + "." + catalog.backups[0].latest!.id + ".enc",
    );
    await closePool(source.pool);
    const admin = createDatabase(url);
    try {
      await admin.pool.query(
        `drop database "${value.sourceDatabase}" with(force)`,
      );
    } finally {
      await closePool(admin.pool);
    }
    await rm(join(root, "source"), { recursive: true, force: true });
    await restoreJournal(
      target.pool,
      restored,
      value,
      copy,
      options.anchors,
      options.journalKey,
    );
    assert.equal(
      (
        await target.pool.query("select hidden from encounter where id=$1", [
          ids[0],
        ])
      ).rows[0].hidden,
      true,
    );
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from user_policy where admitted",
        )
      ).rows[0].n,
      0,
    );
    for (const table of ["session", "verification", "data_export"])
      assert.equal(
        (await target.pool.query(`select count(*)::int n from ${table}`))
          .rows[0].n,
        0,
      );
  }));

test("managed backup and copy I/O failures retry without overwrite; unconfirmed orphan is recovered", async () =>
  exercise(async (source, _target, objects, _restored, root) => {
    const { runRecovery } =
      await import("../src/ops/recovery-orchestration.js");
    const { readdir } = await import("node:fs/promises");
    await seed(source, objects);
    const options = {
      root: join(root, "managed"),
      anchors: join(root, "managed-anchors"),
      backupKey: randomBytes(32),
      journalKey: randomBytes(32),
    };
    await assert.rejects(
      runRecovery(source.pool, objects, "backup", {
        ...options,
        write: async (path, bytes) => {
          if (path.includes("/backups/"))
            throw new Error("synthetic backup write failure");
          await writeJournalFile(path, bytes);
        },
      }),
    );
    assert.equal((await readdir(join(options.root, "backups"))).length, 0);
    assert.equal(
      (await runRecovery(source.pool, objects, "backup", options)).code,
      "recovery_current",
    );
    const backupFiles = await readdir(join(options.root, "backups"));
    const before = await readFile(
      join(options.root, "backups", backupFiles[0]),
    );
    await source.pool.query(
      "update user_policy set status='suspended' where user_id='alice'",
    );
    // Simulate process loss between copy publication and anchor publication:
    // the writer leaves an orphan copy; existing anchor is unchanged.
    await assert.rejects(
      runRecovery(source.pool, objects, "copy", {
        ...options,
        write: async (path, bytes) => {
          if (path.includes("/copies/")) {
            await writeJournalFile(path, bytes);
            throw new Error("synthetic interruption");
          }
          await writeJournalFile(path, bytes);
        },
      }),
    );
    assert.equal((await readdir(join(options.root, "copies"))).length, 2);
    assert.equal(
      (await runRecovery(source.pool, objects, "status", options)).backups[0]
        .code,
      "interrupted",
    );
    assert.equal(
      (await runRecovery(source.pool, objects, "copy", options)).code,
      "recovery_current",
    );
    assert.equal((await readdir(join(options.root, "copies"))).length, 1);
    assert.deepEqual(
      await readFile(join(options.root, "backups", backupFiles[0])),
      before,
    );
    await assert.rejects(
      writeJournalFile(
        join(options.root, "backups", backupFiles[0]),
        Buffer.from("replace"),
      ),
    );
  }));

test("managed operations reject concurrent runs, missing copies and inconsistent state", async () =>
  exercise(async (source, _target, objects, _restored, root) => {
    const { runRecovery } =
      await import("../src/ops/recovery-orchestration.js");
    const { readdir, unlink } = await import("node:fs/promises");
    await seed(source, objects);
    const options = {
      root: join(root, "managed"),
      anchors: join(root, "managed-anchors"),
      backupKey: randomBytes(32),
      journalKey: randomBytes(32),
    };
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const running = runRecovery(source.pool, objects, "backup", {
      ...options,
      write: async (path, bytes) => {
        if (path.includes("/backups/")) {
          entered();
          await gate;
        }
        await writeJournalFile(path, bytes);
      },
    });
    try {
      await ready;
      await assert.rejects(
        runRecovery(source.pool, objects, "rotate", options),
        /busy/,
      );
    } finally {
      release();
    }
    assert.equal((await running).code, "recovery_current");
    await assert.rejects(
      runRecovery(source.pool, objects, "rotate", {
        ...options,
        anchors: join(root, "other-anchors"),
      }),
      /mismatch/,
    );
    await assert.rejects(
      runRecovery(source.pool, objects, "status", {
        ...options,
        journalKey: randomBytes(32),
      }),
      /mismatch/,
    );
    assert.equal((await readdir(options.anchors)).length, 1);
    const latest = (await readdir(join(options.root, "copies")))[0];
    await unlink(join(options.root, "copies", latest));
    assert.equal(
      (await runRecovery(source.pool, objects, "status", options)).backups[0]
        .code,
      "journal_missing",
    );
    await assert.rejects(runRecovery(source.pool, objects, "copy", options));
    assert.equal(
      readRecoveryState(
        await readFile(join(options.root, "state.enc")),
        options.backupKey,
      ).last!.code,
      "failed",
    );
    await writeFile(
      join(options.root, "state.enc"),
      JSON.stringify({ version: 1, backups: [] }),
    );
    await assert.rejects(runRecovery(source.pool, objects, "rotate", options));
    assert.equal((await readdir(join(options.root, "backups"))).length, 1);
  }));

test("managed rotation uses original backup age and preserves retained backup/copy pairs", async (t) =>
  exercise(async (source, target, objects, restored, root) => {
    const { runRecovery } =
      await import("../src/ops/recovery-orchestration.js");
    const { readdir } = await import("node:fs/promises");
    await seed(source, objects);
    const options = {
      root: join(root, "managed"),
      anchors: join(root, "managed-anchors"),
      backupKey: randomBytes(32),
      journalKey: randomBytes(32),
    };
    const first = (await runRecovery(source.pool, objects, "backup", options))
      .backups[0];
    await runRecovery(source.pool, objects, "backup", options);
    // Prepared synthetic retained archive, captured 29 days earlier, with a
    // recent copy. This fixture proves copying does not reset the expiry.
    const statePath = join(options.root, "state.enc");
    const state = readRecoveryState(
      await readFile(statePath),
      options.backupKey,
    );
    const b = state.backups.find(
      (entry: { id: string }) => entry.id === first.id,
    );
    assert.ok(b);
    const archivePath = join(options.root, "backups", b.id + ".enc");
    const value = unseal<import("../src/ops/recovery.js").Backup>(
      await readFile(archivePath),
      options.backupKey,
    );
    const captured = Date.now() - 29 * 86400000;
    value.capturedAt = b.capturedAt = new Date(captured).toISOString();
    const bytes = seal(value, options.backupKey);
    b.digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(archivePath, bytes);
    await writeFile(statePath, seal(state, options.backupKey));
    assert.equal(
      (await runRecovery(source.pool, objects, "status", options)).code,
      "recovery_current",
    );
    t.mock.timers.enable({ apis: ["Date"], now: captured + 30 * 86400000 - 1 });
    await runRecovery(source.pool, objects, "rotate", options);
    assert.equal((await readdir(join(options.root, "backups"))).length, 2);
    t.mock.timers.tick(1);
    await runRecovery(source.pool, objects, "rotate", options);
    assert.equal((await readdir(join(options.root, "backups"))).length, 1);
    assert.equal((await readdir(join(options.root, "copies"))).length, 1);
    assert.equal((await readdir(options.anchors)).length, 1);
    const remaining = readRecoveryState(
      await readFile(statePath),
      options.backupKey,
    ).backups[0];
    const retained = unseal<import("../src/ops/recovery.js").Backup>(
      await readFile(join(options.root, "backups", remaining.id + ".enc")),
      options.backupKey,
    );
    await restoreJournal(
      target.pool,
      restored,
      retained,
      join(
        options.root,
        "copies",
        remaining.id + "." + remaining.latest!.id + ".enc",
      ),
      options.anchors,
      options.journalKey,
    );
    assert.equal(
      (await target.pool.query('select count(*)::int n from "user"')).rows[0].n,
      2,
    );
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from user_policy where admitted",
        )
      ).rows[0].n,
      0,
    );
  }));

test("managed journal resumes after actual process loss following anchor publication", async () =>
  exercise(async (source, _target, objects, _restored, root) => {
    const { runRecovery } =
      await import("../src/ops/recovery-orchestration.js");
    const { pathToFileURL } = await import("node:url");
    const { readdir } = await import("node:fs/promises");
    await seed(source, objects);
    const options = {
      root: join(root, "managed"),
      anchors: join(root, "managed-anchors"),
      backupKey: randomBytes(32),
      journalKey: randomBytes(32),
    };
    await runRecovery(source.pool, objects, "backup", options);
    await source.pool.query(
      "update user_policy set status='withdrawn' where user_id='alice'",
    );
    const script = join(root, "interrupt.mts"),
      keys = join(root, "keys");
    await writeFile(
      keys,
      Buffer.concat([options.backupKey, options.journalKey]),
      { mode: 0o600 },
    );
    const moduleUrl = (path: string) =>
      JSON.stringify(pathToFileURL(join(process.cwd(), path)).href);
    await writeFile(
      script,
      `
      import {readFile} from 'node:fs/promises';
      import {createDatabase} from ${moduleUrl("server/src/infrastructure/db/client.ts")};
      import {LocalStorage} from ${moduleUrl("server/src/encounters/storage.ts")};
      import {runRecovery} from ${moduleUrl("server/src/ops/recovery-orchestration.ts")};
      import {writeJournalFile} from ${moduleUrl("server/src/ops/decision-journal.ts")};
      const [root, anchors, media, keysPath] = process.argv.slice(2);
      const keys = await readFile(keysPath);
      const {pool} = createDatabase(process.env.TEST_DATABASE_URL!);
      await runRecovery(pool, new LocalStorage(media), 'copy', {
        root, anchors, backupKey:keys.subarray(0,32),journalKey:keys.subarray(32),
        write: async (path, bytes) => {
          await writeJournalFile(path, bytes);
          if(path.endsWith('.anchor')) process.kill(process.pid, 'SIGKILL');
        }
      });
    `,
    );
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          script,
          options.root,
          options.anchors,
          join(root, "source"),
          keys,
        ],
        {
          env: {
            ...process.env,
            TEST_DATABASE_URL: source.pool.options.connectionString,
          },
        },
      ),
      (error: unknown) => (error as { signal: string }).signal === "SIGKILL",
    );
    const interrupted = readRecoveryState(
      await readFile(join(options.root, "state.enc")),
      options.backupKey,
    );
    assert.equal(interrupted.last!.code, "started");
    assert.ok(interrupted.backups[0].pendingCopy);
    assert.equal((await readdir(join(options.root, "copies"))).length, 2);
    assert.equal(
      (await runRecovery(source.pool, objects, "copy", options)).code,
      "recovery_current",
    );
    assert.equal((await readdir(join(options.root, "copies"))).length, 1);
    assert.equal((await readdir(options.anchors)).length, 1);
  }));

test("managed CLI reports safe technical status and requires explicit synthetic operation", async () =>
  exercise(async (source, _target, objects, _restored, root) => {
    await seed(source, objects);
    const backupKey = join(root, "backup-key"),
      journalKey = join(root, "journal-key");
    await writeFile(backupKey, randomBytes(32), { mode: 0o600 });
    await writeFile(journalKey, randomBytes(32), { mode: 0o600 });
    const env = {
      ...process.env,
      TEST_DATABASE_URL: source.pool.options.connectionString,
      MIAOU_SYNTHETIC_RECOVERY: "1",
      MIAOU_LOCAL_MEDIA_DIR: join(root, "source"),
      MIAOU_RECOVERY_KEY_FILE: backupKey,
      MIAOU_DECISIONS_KEY_FILE: journalKey,
      MIAOU_JOURNAL_ANCHOR_DIR: join(root, "anchors"),
    };
    const command = (action: string, overrides = {}) =>
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "server/src/ops/recovery-cli.ts",
          action,
          join(root, "managed"),
        ],
        { env: { ...env, ...overrides } },
      );
    const created = JSON.parse((await command("manage-backup")).stdout);
    assert.equal(created.code, "recovery_current");
    assert.equal(created.backups[0].uncopiedAfterCut, "unknown");
    const output = (await command("manage-status")).stdout;
    for (const privateValue of [
      "Synthetic",
      "alice",
      "bob",
      "example.test",
      "image.webp",
      "miaou_test",
      root,
    ])
      assert.ok(!output.includes(privateValue));
    await source.pool.query(
      "update user_policy set status='suspended' where user_id='alice'",
    );
    await assert.rejects(command("manage-status"), (error: unknown) => {
      const failure = error as { code: number; stdout: string };
      assert.equal(failure.code, 1);
      assert.equal(
        JSON.parse(failure.stdout).backups[0].code,
        "journal_behind",
      );
      return true;
    });
    assert.equal(
      JSON.parse((await command("manage-copy")).stdout).code,
      "recovery_current",
    );
    await assert.rejects(
      command("manage-backup", { MIAOU_SYNTHETIC_RECOVERY: "0" }),
    );
    await assert.rejects(
      command("manage-backup", {
        TEST_DATABASE_URL: "postgresql://x:x@localhost/miaou_dev",
      }),
    );
  }));

test("managed rotation records deletion failure and resumes interrupted expiry without extending retention", async () =>
  exercise(async (source, _target, objects, _restored, root) => {
    const { runRecovery } =
      await import("../src/ops/recovery-orchestration.js");
    const { chmod, readdir } = await import("node:fs/promises");
    await seed(source, objects);
    const options = {
      root: join(root, "managed"),
      anchors: join(root, "anchors"),
      backupKey: randomBytes(32),
      journalKey: randomBytes(32),
    };
    await runRecovery(source.pool, objects, "backup", options);
    const statePath = join(options.root, "state.enc");
    const state = readRecoveryState(
      await readFile(statePath),
      options.backupKey,
    );
    state.backups[0].capturedAt = new Date(
      Date.now() - 31 * 86400000,
    ).toISOString();
    const archivePath = join(
      options.root,
      "backups",
      state.backups[0].id + ".enc",
    );
    const value = unseal<import("../src/ops/recovery.js").Backup>(
      await readFile(archivePath),
      options.backupKey,
    );
    // A valid but inconsistent catalog must not expire a younger archive.
    await writeFile(statePath, seal(state, options.backupKey));
    await assert.rejects(
      runRecovery(source.pool, objects, "rotate", options),
      /catalog mismatch/,
    );
    value.capturedAt = state.backups[0].capturedAt;
    const encrypted = seal(value, options.backupKey);
    state.backups[0].digest = createHash("sha256")
      .update(encrypted)
      .digest("hex");
    await writeFile(archivePath, encrypted);
    await writeFile(statePath, seal(state, options.backupKey));
    const archives = join(options.root, "backups");
    await chmod(archives, 0o500);
    try {
      await assert.rejects(
        runRecovery(source.pool, objects, "rotate", options),
      );
    } finally {
      await chmod(archives, 0o700);
    }
    const failed = readRecoveryState(
      await readFile(statePath),
      options.backupKey,
    );
    assert.equal(failed.last!.code, "failed");
    assert.equal(failed.backups[0].phase, "deleting");
    assert.equal((await readdir(join(options.root, "copies"))).length, 1);
    // Process loss after unlinking an archive is idempotently recoverable.
    await rm(join(archives, failed.backups[0].id + ".enc"));
    assert.equal(
      (await runRecovery(source.pool, objects, "rotate", options)).code,
      "rotation_completed",
    );
    for (const path of [
      archives,
      join(options.root, "copies"),
      options.anchors,
    ])
      assert.equal((await readdir(path)).length, 0);
    assert.equal(
      (await runRecovery(source.pool, objects, "status", options)).code,
      "recovery_attention",
    );
  }));
