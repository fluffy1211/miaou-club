import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import {
  ResticRepository,
  command,
  cycle,
  inspectStatus,
  notifyFailure,
  privateFile,
} from "./remote-backup-repository.mjs";
import { withRenderPaused } from "./backup-render-quiescence.mjs";

async function jsonFile(path) {
  assert.ok((await privateFile(path)).size <= 65536);
  return JSON.parse(await readFile(path, "utf8"));
}
async function directory(path) {
  assert.ok(
    isAbsolute(path) &&
      resolve(path) === path &&
      (await realpath(path)) === path,
  );
  const s = await lstat(path);
  assert.ok(s.isDirectory() && (s.mode & 0o777) === 0o700);
}
function separate(paths) {
  for (const [i, a] of paths.entries())
    for (const b of paths.slice(i + 1))
      assert.ok(a !== b && !a.startsWith(b + sep) && !b.startsWith(a + sep));
}
export function sourceConnection(env) {
  const url = new URL(env.DATABASE_URL);
  assert.ok(
    url.protocol === "postgresql:" &&
      url.hostname.endsWith(".neon.tech") &&
      !url.hostname.includes("-pooler."),
  );
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.ok(
    [...url.searchParams.keys()].every((k) =>
      ["sslmode", "channel_binding"].includes(k),
    ),
  );
  assert.ok(url.searchParams.getAll("sslmode").length === 1);
  const values = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "system",
  };
  assert.ok(Object.values(values).every((s) => s && !/[\r\n\0]/.test(s)));
  return { url: url.href, values };
}

// Credentials travel only through the child's environment, never argv/stderr.
export async function dumpDatabase(config, values, snapshot, path, signal) {
  assert.match(snapshot, /^[0-9A-Fa-f-]+$/);
  const file = await open(path, "wx", 0o600);
  let child;
  const abort = () => child?.kill("SIGKILL");
  try {
    signal.throwIfAborted();
    child = spawn(
      config.pgDumpBinary,
      ["-Fc", "--no-owner", "--no-acl", "--snapshot=" + snapshot],
      {
        env: { PATH: process.env.PATH, ...values },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = new Promise((fulfil, reject) => {
      child.once("error", () => reject(Error("Dump failed")));
      child.once("close", (code) =>
        code === 0 ? fulfil() : reject(Error("Dump failed")),
      );
    });
    void exited.catch(() => {});
    child.stderr.on("data", () => {});
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    let bytes = 0;
    try {
      for await (const chunk of child.stdout) {
        bytes += chunk.length;
        assert.ok(bytes <= 1024 ** 3);
        await file.writeFile(chunk);
      }
      await exited;
      signal.throwIfAborted();
      assert.ok(bytes > 0);
      await file.sync();
    } catch {
      abort();
      await exited.catch(() => {});
      throw Error("Dump failed");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await file.close();
  }
}

async function defaults() {
  const [
    { Pool },
    { SupabaseStorage },
    { captureBundle },
    { captureJournalBundle },
  ] = await Promise.all([
    import("pg"),
    import("../server/src/encounters/storage.ts"),
    import("../server/src/ops/backup-bundle.ts"),
    import("../server/src/ops/backup-quarantine.ts"),
  ]);
  return {
    pool: (url) =>
      new Pool({
        connectionString: url,
        max: 2,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      }),
    storage: (e) =>
      new SupabaseStorage(
        e.MIAOU_STORAGE_URL,
        e.MIAOU_STORAGE_SECRET,
        e.MIAOU_STORAGE_BUCKET,
      ),
    captureBundle,
    captureJournal: captureJournalBundle,
    pause: withRenderPaused,
    repository: (c) =>
      new ResticRepository({ ...c.repo, source: c.source, timeoutMs: 180000 }),
    dump: dumpDatabase,
    checkDump: async (c) =>
      assert.match(
        await command(c.pgDumpBinary, ["--version"], {
          env: { PATH: process.env.PATH },
          timeoutMs: 10000,
        }),
        /^pg_dump \(PostgreSQL\) 17\./,
      ),
  };
}

export async function runRemote(action, configFile, flags = {}, injected) {
  let root, pool, owned;
  try {
    assert.ok(["init", "backup", "status"].includes(action));
    const c = await jsonFile(configFile);
    assert.equal(c.version, 1);
    assert.equal(c.source, "miaou-preproduction");
    assert.ok(
      Object.keys(c).every((k) =>
        [
          "version",
          "source",
          "enabled",
          "allowPause",
          "expectedScope",
          "closedQualification",
          "sourceEnvFile",
          "stagingParent",
          "journalRoot",
          "anchorsRoot",
          "journalKeyFile",
          "tokenFile",
          "repo",
          "stateFile",
          "pgDumpBinary",
          "service",
          "alertWebhookFile",
        ].includes(k),
      ),
    );
    let alertUrl;
    if (c.alertWebhookFile) {
      assert.ok((await privateFile(c.alertWebhookFile)).size <= 4096);
      alertUrl = (await readFile(c.alertWebhookFile, "utf8")).trim();
      assert.equal(new URL(alertUrl).protocol, "https:");
    }
    if (action === "status") {
      const s = await inspectStatus(c.stateFile).catch(() => ({
        code: "backup_overdue",
      }));
      if (s.code !== "backup_ok" && alertUrl)
        await notifyFailure(alertUrl, s.code);
      return s;
    }
    assert.equal(c.enabled, true);
    assert.ok(c.repo.repository.startsWith("s3:https://"));
    assert.deepEqual(Object.keys(c.repo).sort(), [
      "binary",
      "credentialsFile",
      "passwordFile",
      "repository",
    ]);
    new ResticRepository({ ...c.repo, source: c.source });
    const deps = injected ?? (await defaults());
    const repository = deps.repository(c);
    if (action === "init") {
      await repository.initialize();
      return { code: "backup_repository_initialized" };
    }
    assert.equal(flags.allowServicePause, true);
    assert.equal(c.allowPause, true);
    assert.equal(c.expectedScope, "closed-preproduction");
    assert.equal(c.closedQualification, true);
    for (const dir of [c.stagingParent, c.journalRoot, c.anchorsRoot])
      await directory(dir);
    separate([c.stagingParent, c.journalRoot, c.anchorsRoot]);
    const secrets = [
      configFile,
      c.sourceEnvFile,
      c.journalKeyFile,
      c.tokenFile,
      c.repo.passwordFile,
      c.repo.credentialsFile,
      ...(c.alertWebhookFile ? [c.alertWebhookFile] : []),
    ];
    for (const secret of secrets) {
      await privateFile(secret);
      for (const dir of [c.stagingParent, c.journalRoot, c.anchorsRoot])
        assert.ok(!secret.startsWith(dir + sep));
    }
    assert.equal((await readFile(c.journalKeyFile)).length, 32);
    assert.ok(
      !Buffer.from(await readFile(c.repo.passwordFile)).equals(
        await readFile(c.journalKeyFile),
      ),
    );
    await directory(dirname(c.stateFile));
    assert.ok(isAbsolute(c.stateFile) && resolve(c.stateFile) === c.stateFile);
    separate([...secrets, c.stateFile]);
    for (const dir of [c.stagingParent, c.journalRoot, c.anchorsRoot])
      assert.ok(c.stateFile !== dir && !c.stateFile.startsWith(dir + sep));
    assert.ok((await privateFile(c.sourceEnvFile)).size <= 65536);
    const env = parse(await readFile(c.sourceEnvFile));
    assert.ok(
      !env.MIAOU_TERMS_VERSION &&
        !env.GOOGLE_CLIENT_ID &&
        !env.GOOGLE_CLIENT_SECRET,
    );
    const connection = sourceConnection(env);
    const storageURL = new URL(env.MIAOU_STORAGE_URL);
    assert.ok(
      storageURL.protocol === "https:" &&
        storageURL.origin === env.MIAOU_STORAGE_URL &&
        storageURL.hostname.endsWith(".supabase.co"),
    );
    assert.ok(
      env.MIAOU_STORAGE_SECRET && /^[a-z0-9-]+$/.test(env.MIAOU_STORAGE_BUCKET),
    );
    assert.ok(isAbsolute(c.pgDumpBinary));
    await deps.checkDump(c);
    pool = deps.pool(connection.url);
    async function checkClosed() {
      const closed = await pool.query(
        "select (select count(*)::int from user_policy where admitted) admitted,(select count(*)::int from admission where active) invitations",
      );
      assert.equal(closed.rows[0].admitted, 0);
      assert.equal(closed.rows[0].invitations, 0);
    }
    await checkClosed();
    const storage = deps.storage(env);
    const id = randomUUID();
    root = join(c.stagingParent, id);
    let pauseStatus, journal;
    const receipt = await cycle({
      repository,
      stateFile: c.stateFile,
      alertUrl,
      capture: async () => {
        pauseStatus = await deps.pause(
          {
            ...c.service,
            serviceId: c.service.id,
            serviceName: c.service.name,
            tokenFile: c.tokenFile,
            allowPause: c.allowPause,
            expectedScope: c.expectedScope,
            timeoutMs: 120000,
          },
          async ({ signal }) => {
            await checkClosed();
            const manifest = await deps.captureBundle({
              pool,
              storage,
              root,
              source: c.source,
              writersStopped: true,
              deadlineMs: 120000,
              dump: (snapshot, path, childSignal) =>
                deps.dump(
                  c,
                  connection.values,
                  snapshot,
                  path,
                  AbortSignal.any([signal, childSignal]),
                ),
            });
            owned = await lstat(root);
            signal.throwIfAborted();
            journal = await deps.captureJournal({
              pool,
              manifest,
              journalFile: join(c.journalRoot, manifest.id + ".enc"),
              anchorsRoot: c.anchorsRoot,
              keyFile: c.journalKeyFile,
            });
            signal.throwIfAborted();
          },
        );
        return root;
      },
    });
    root = undefined;
    return {
      code: "backup_ok",
      receipt,
      journal,
      pause: {
        recovered: pauseStatus.recovered,
        pauseStartedAt: pauseStatus.pauseStartedAt,
        resumedAt: pauseStatus.resumedAt,
      },
    };
  } catch {
    throw Error("Remote backup operation failed");
  } finally {
    if (root && owned) {
      const current = await lstat(root).catch(() => undefined);
      if (current?.ino === owned.ino && current?.dev === owned.dev)
        await rm(root, { recursive: true, force: true }).catch(() => {
          throw Error("Remote backup staging cleanup failed");
        });
    }
    if (pool) await pool.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [action, config, ...args] = process.argv.slice(2);
  try {
    assert.ok(
      args.length === 0 ||
        (args.length === 1 && args[0] === "--allow-service-pause"),
    );
    const result = await runRemote(action, config, {
      allowServicePause: args.length === 1,
    });
    console.log(JSON.stringify(result));
    if (!["backup_ok", "backup_repository_initialized"].includes(result.code))
      process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ code: "backup_failed" }));
    process.exitCode = 1;
  }
}
