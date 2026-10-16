import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  dumpDatabase,
  runRemote,
  sourceConnection,
} from "../scripts/backup-remote-runner.mjs";
const { AbortController } = globalThis;

async function fixture(t) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "miaou-runner-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const c = {
    version: 1,
    source: "miaou-preproduction",
    enabled: true,
    allowPause: true,
    expectedScope: "closed-preproduction",
    closedQualification: true,
    sourceEnvFile: join(root, "source.env"),
    stagingParent: join(root, "staging"),
    journalRoot: join(root, "journal"),
    anchorsRoot: join(root, "anchors"),
    journalKeyFile: join(root, "journal.key"),
    tokenFile: join(root, "render-token"),
    stateFile: join(root, "state.json"),
    pgDumpBinary: "/synthetic/pg_dump",
    service: {
      id: "srv-" + "a".repeat(20),
      name: "miaou-preproduction",
      origin: "https://miaou.example.test",
      expectedDigest: "sha256:" + "a".repeat(64),
    },
    repo: {
      binary: "/synthetic/restic",
      repository:
        "s3:https://s3.eu-central-003.backblazeb2.com/miaou-backups/repository",
      passwordFile: join(root, "restic-password"),
      credentialsFile: join(root, "b2-credentials"),
    },
  };
  for (const dir of [c.stagingParent, c.journalRoot, c.anchorsRoot])
    await mkdir(dir, { mode: 0o700 });
  const env =
    "DATABASE_URL=postgresql://synthetic:secret-sentinel@ep-synthetic.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full\nMIAOU_STORAGE_URL=https://synthetic.supabase.co\nMIAOU_STORAGE_SECRET=secret-sentinel\nMIAOU_STORAGE_BUCKET=photos\n";
  for (const [path, bytes] of [
    [c.sourceEnvFile, env],
    [c.journalKeyFile, Buffer.alloc(32, 7)],
    [c.tokenFile, "render-secret-sentinel"],
    [c.repo.passwordFile, "separate-restic-password-sentinel-32bytes"],
    [c.repo.credentialsFile, "{}"],
  ])
    await writeFile(path, bytes, { mode: 0o600 });
  const file = join(root, "config.json"),
    events = [];
  let stage;
  const save = () => writeFile(file, JSON.stringify(c), { mode: 0o600 });
  await save();
  const deps = {
    checkDump: async () => events.push("dump-version"),
    pool: () => ({
      query: async () => {
        events.push("closed");
        return { rows: [{ admitted: 0, invitations: 0 }] };
      },
      end: async () => events.push("end"),
    }),
    storage: () => ({}),
    pause: async (o, task) => {
      assert.equal(o.allowPause, true);
      events.push("pause");
      const result = await task({ signal: new AbortController().signal });
      events.push("resume");
      return { recovered: true, value: result };
    },
    captureBundle: async (o) => {
      stage = o.root;
      events.push("capture");
      await mkdir(stage, { mode: 0o700 });
      await writeFile(join(stage, "database.dump"), "synthetic-plaintext", {
        mode: 0o600,
      });
      return { id: randomUUID() };
    },
    captureJournal: async () => {
      events.push("journal");
      return {
        copiedAt: new Date().toISOString(),
        copiedThrough: "0",
        uncopiedAfterCut: "unknown",
      };
    },
    dump: async () => {},
    repository: () => ({
      initialize: async () => events.push("init"),
      backup: async () => {
        events.push("backup");
        return { snapshotId: "b".repeat(64) };
      },
      rotate: async () => {
        events.push("rotate");
        return { physicalProviderVersionPurgeVerified: false };
      },
    }),
  };
  return { c, file, root, events, deps, save, stage: () => stage };
}

test("closed capture and journal finish before resume; restic runs afterwards and plaintext is removed", async (t) => {
  const f = await fixture(t);
  const result = await runRemote(
    "backup",
    f.file,
    { allowServicePause: true },
    f.deps,
  );
  assert.deepEqual(f.events, [
    "dump-version",
    "closed",
    "pause",
    "closed",
    "capture",
    "journal",
    "resume",
    "backup",
    "rotate",
    "end",
  ]);
  assert.equal(result.code, "backup_ok");
  assert.equal(result.journal.uncopiedAfterCut, "unknown");
  assert.equal(JSON.stringify(result).includes("secret-sentinel"), false);
  await assert.rejects(lstat(f.stage()));
  assert.equal(JSON.parse(await readFile(f.c.stateFile)).code, "backup_ok");
});

test("init uses no source, Render, storage or dump dependency", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.file,
    JSON.stringify({
      version: 1,
      source: f.c.source,
      enabled: true,
      repo: f.c.repo,
    }),
    { mode: 0o600 },
  );
  const result = await runRemote(
    "init",
    f.file,
    {},
    { repository: f.deps.repository },
  );
  assert.equal(result.code, "backup_repository_initialized");
  assert.deepEqual(f.events, ["init"]);
});

test("backup failures persist safe failure and remove staging after source resume", async (t) => {
  const f = await fixture(t);
  f.deps.repository = () => ({
    backup: async () => {
      f.events.push("backup-failed");
      throw Error("secret-sentinel");
    },
  });
  await assert.rejects(
    runRemote("backup", f.file, { allowServicePause: true }, f.deps),
    (e) => e.message === "Remote backup operation failed",
  );
  assert.ok(f.events.indexOf("resume") < f.events.indexOf("backup-failed"));
  const status = await readFile(f.c.stateFile, "utf8");
  assert.equal(JSON.parse(status).code, "backup_failed");
  assert.equal(status.includes("secret-sentinel"), false);
  await assert.rejects(lstat(f.stage()));
});

test("failed resume also cleans successfully captured plaintext and refuses archival", async (t) => {
  const f = await fixture(t);
  f.deps.pause = async (_o, task) => {
    await task({ signal: new AbortController().signal });
    throw Error("secret-sentinel");
  };
  await assert.rejects(
    runRemote("backup", f.file, { allowServicePause: true }, f.deps),
  );
  await assert.rejects(lstat(f.stage()));
  assert.equal(f.events.includes("backup"), false);
});

test("missing/private/disabled/unsafe configuration fails before pause or repository mutation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    runRemote("backup", join(f.root, "missing"), {}, f.deps),
  );
  await assert.rejects(runRemote("backup", f.file, {}, f.deps));
  assert.deepEqual(f.events, []);
  for (const [key, value] of [
    ["enabled", false],
    ["closedQualification", false],
    ["expectedScope", "production"],
    ["stateFile", f.c.journalKeyFile],
    ["journalRoot", f.c.stagingParent],
    ["unknown", true],
  ]) {
    const original = f.c[key];
    f.c[key] = value;
    await f.save();
    await assert.rejects(
      runRemote("backup", f.file, { allowServicePause: true }, f.deps),
    );
    if (original === undefined) delete f.c[key];
    else f.c[key] = original;
  }
  await f.save();
  await chmod(f.file, 0o644);
  await assert.rejects(
    runRemote("backup", f.file, { allowServicePause: true }, f.deps),
  );
  assert.deepEqual(f.events, []);
});

test("Neon TLS direct endpoint and connection parameters cannot be overridden", () => {
  for (const value of [
    "postgresql://u:p@local.test/db?sslmode=verify-full",
    "postgresql://u:p@ep-test-pooler.eu.neon.tech/db?sslmode=verify-full",
    "postgresql://u:p@ep-test.eu.neon.tech/db?sslmode=require",
    "postgresql://u:p@ep-test.eu.neon.tech/db?sslmode=verify-full&host=local.test",
    "postgresql://u:p@ep-test.eu.neon.tech/db?sslmode=verify-full&sslmode=disable",
  ])
    assert.throws(() => sourceConnection({ DATABASE_URL: value }));
  const valid = sourceConnection({
    DATABASE_URL:
      "postgresql://u:p@ep-test.eu.neon.tech/db?sslmode=verify-full",
  });
  assert.equal(valid.values.PGSSLROOTCERT, "system");
  assert.equal(valid.values.PGSSLMODE, "verify-full");
});

test("status never contacts a source and marks absent persisted state overdue", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await runRemote("status", f.file), {
    code: "backup_overdue",
  });
  assert.deepEqual(f.events, []);
});

test("native dump keeps credentials out of argv and abort waits for child exit", async (t) => {
  const f = await fixture(t),
    binary = join(f.root, "pg_dump"),
    marker = join(f.root, "pid");
  await writeFile(
    binary,
    `#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(process.env.MARKER,JSON.stringify({pid:process.pid,args:process.argv.slice(2),password:process.env.PGPASSWORD}));process.stdout.write('synthetic-dump');setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  );
  const controller = new AbortController();
  const pending = dumpDatabase(
    { pgDumpBinary: binary },
    { PGPASSWORD: "secret-sentinel", MARKER: marker },
    "00000001-1",
    join(f.root, "dump"),
    controller.signal,
  );
  for (let i = 0; i < 100; i++) {
    if (await lstat(marker).catch(() => false)) break;
    await delay(10);
  }
  const child = JSON.parse(await readFile(marker));
  controller.abort();
  await assert.rejects(pending, /Dump failed/);
  assert.equal(child.password, "secret-sentinel");
  assert.equal(child.args.join(" ").includes("secret"), false);
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
});
