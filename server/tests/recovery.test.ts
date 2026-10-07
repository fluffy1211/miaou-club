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
    assert.equal(count, 13);
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

test("journal upgrade from delivered schema keeps content; pruning rejects backups below the retained floor", async () => {
  await mkdir(".cache", { recursive: true, mode: 0o700 });
  const previous = await mkdtemp(
    join(process.cwd(), ".cache", "miaou-journal-upgrade-"),
  );
  try {
    await cp("server/drizzle", previous, { recursive: true });
    await rm(join(previous, "0012_strong_golden_guardian.sql"));
    const metadata = JSON.parse(
      await readFile(join(previous, "meta/_journal.json"), "utf8"),
    );
    metadata.entries.pop();
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
