import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { migrateDatabase } from "../src/infrastructure/db/migrations.js";
import { LocalStorage } from "../src/encounters/storage.js";
import { captureBundle } from "../src/ops/backup-bundle.js";
import {
  captureJournalBundle,
  restoreQuarantine,
} from "../src/ops/backup-quarantine.js";
// @ts-expect-error Operational JavaScript boundary; integration asserts returned receipt/manifest.
import { ResticRepository } from "../../scripts/remote-backup-repository.mjs";
import { assertLocalTestDatabase } from "../src/ops/recovery.js";
const url = process.env.TEST_DATABASE_URL;
assert.ok(url);
assertLocalTestDatabase(url);
assert.match(
  process.env.MIAOU_BACKUP_TEST_CONTAINER ?? "",
  /^miaou-backup-test-[a-zA-Z0-9-]+$/,
);
assert.ok(process.env.MIAOU_RESTIC_BINARY);
async function pg(
  binary: string,
  db: string,
  args: string[],
  signal: AbortSignal,
  input?: Buffer,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const c = spawn(
      "docker",
      [
        "exec",
        "-i",
        process.env.MIAOU_BACKUP_TEST_CONTAINER!,
        binary,
        "-U",
        "miaou_test",
        "-d",
        db,
        ...args,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let failed = false;
    const abort = () => {
      failed = true;
      c.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    c.stdout.on("data", (b: Buffer) => chunks.push(b));
    c.stderr.on("data", () => {});
    c.stdin.on("error", () => {
      failed = true;
    });
    c.on("error", () => {
      failed = true;
    });
    c.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (code || failed)
        reject(Error("PostgreSQL rehearsal operation failed"));
      else resolve(Buffer.concat(chunks));
    });
    c.stdin.end(input);
    if (signal.aborted) abort();
  });
}
test("real pg_dump -> restic -> source loss -> verified bundle -> restricted quarantine, with an independent journal", async () => {
  const root = await mkdtemp(
    join(realpathSync(tmpdir()), "miaou-repository-rehearsal-"),
  );
  const admin = createDatabase(url);
  const uid = randomUUID().replaceAll("-", "");
  const srcName = `backup_${uid}_test`,
    dstName = `backup_${uid}_quarantine`;
  const conn = (name: string) => {
    const u = new URL(url!);
    u.pathname = name;
    return u.href;
  };
  const src = createDatabase(conn(srcName)),
    target = createDatabase(conn(dstName));
  try {
    await admin.pool.query(`create database "${srcName}"`);
    await admin.pool.query(`create database "${dstName}"`);
    await migrateDatabase(src.pool, "server/drizzle");
    await src.pool.query(
      `insert into "user"(id,name,email) values('alice','Synthetic','alice@example.test')`,
    );
    await src.pool.query(
      `insert into user_policy(user_id,admitted) values('alice',true)`,
    );
    await src.pool.query(
      `insert into admission(email) values('alice@example.test')`,
    );
    await src.pool.query(
      `insert into session(id,token,user_id,expires_at,updated_at) values('old','synthetic-session','alice',now()+interval '1day',now())`,
    );
    const id = randomUUID();
    await src.pool.query(
      `insert into media(id,owner_id,state,bytes,width,height,original_present,expires_at) values($1,'alice','ready',20,40,40,false,now()+interval '1day')`,
      [id],
    );
    await src.pool.query(
      `insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,encounter_date) values($1,'alice',$1,$1,'synthetic','Synthetic cat',current_date)`,
      [id],
    );
    const media = new LocalStorage(join(root, "source-media"));
    await media.put(id + "/image.webp", Buffer.from("synthetic-webp"));
    await media.put(id + "/thumb.webp", Buffer.from("synthetic-thumb"));
    const base = join(root, "bundle");
    const manifest = await captureBundle({
      pool: src.pool,
      storage: media,
      root: base,
      source: "miaou-test",
      writersStopped: true,
      dump: async (snapshot, path, signal) => {
        await writeFile(
          path,
          await pg(
            "pg_dump",
            srcName,
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
    for (const name of ["keys", "journals", "anchors"])
      await mkdir(join(root, name), { mode: 0o700 });
    const password = join(root, "keys", "restic"),
      keyFile = join(root, "keys", "journal");
    await writeFile(password, randomBytes(32).toString("hex"), { mode: 0o600 });
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    const repo = new ResticRepository({
      binary: process.env.MIAOU_RESTIC_BINARY,
      repository: join(root, "repository"),
      passwordFile: password,
      source: "miaou-test",
    });
    await repo.initialize();
    const receipt = await repo.backup(base);
    await src.pool.query(
      "update encounter set hidden=true,visibility='private' where id=$1",
      [id],
    );
    const journalFile = join(root, "journals", "latest"),
      anchorsRoot = join(root, "anchors");
    await captureJournalBundle({
      pool: src.pool,
      manifest,
      journalFile,
      anchorsRoot,
      keyFile,
    });
    await closePool(src.pool);
    await admin.pool.query(`drop database "${srcName}" with(force)`);
    await rm(join(root, "source-media"), { recursive: true });
    await rm(base, { recursive: true });
    const recovered = join(root, "recovered");
    await repo.recover(receipt, recovered);
    const result = await restoreQuarantine({
      pool: target.pool,
      controlPool: admin.pool,
      bundleRoot: recovered,
      mediaRoot: join(root, "restored-media"),
      journalFile,
      anchorsRoot,
      keyFile,
      targetIsolated: true,
      restore: async (path, signal) => {
        await pg(
          "pg_restore",
          dstName,
          ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"],
          signal,
          await readFile(path),
        );
      },
    });
    assert.equal(result.quarantined, true);
    assert.equal(result.admissionsClosed, true);
    assert.equal(result.databaseConnectionsDisabled, true);
    assert.equal(
      (
        await admin.pool.query(
          "select datallowconn from pg_database where datname=$1",
          [dstName],
        )
      ).rows[0].datallowconn,
      false,
    );
    const q = await target.pool.query(
      "select hidden,visibility from encounter where id=$1",
      [id],
    );
    assert.equal(q.rows[0].hidden, true);
    assert.equal(q.rows[0].visibility, "private");
    assert.equal(
      (await target.pool.query("select count(*)::int n from session")).rows[0]
        .n,
      0,
    );
    assert.equal(
      (
        await target.pool.query(
          "select count(*)::int n from user_policy where admitted",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    if (!src.pool.ending) await closePool(src.pool);
    await closePool(target.pool);
    for (const name of [srcName, dstName])
      await admin.pool.query(`drop database if exists "${name}" with(force)`);
    await closePool(admin.pool);
    await rm(root, { recursive: true, force: true });
  }
});
