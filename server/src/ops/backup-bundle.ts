import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { ObjectStorage } from "../encounters/storage.js";

// This inventory is intentionally strict: a schema addition requires a review
// of capture completeness. The local synthetic recovery API remains separate.
const tables = [
  "user",
  "admission",
  "user_policy",
  "profile",
  "account",
  "two_factor",
  "session",
  "session_security",
  "verification",
  "auth_limit",
  "security_audit",
  "mail_attempt",
  "media",
  "encounter",
  "upload_attempt",
  "report",
  "moderation_audit",
  "report_consultation",
  "data_export",
  "account_deletion",
  "account_activity",
  "friend_attempt",
  "friendship",
  "recovery_state",
  "recovery_decision",
].sort();
const maxDumpBytes = 1024 ** 3;
const maxPhotoBytes = 30_000_000;
const maxTotalPhotoBytes = 10 * 1024 ** 3;
const maximumDeadlineMs = 10 * 60_000;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export type BundleFile = { path: string; bytes: number; sha256: string };
export type BundleManifest = {
  version: 1;
  kind: "miaou-remote-backup-bundle";
  id: string;
  source: string;
  capturedAt: string;
  postgresMajor: 17;
  schema: {
    signature: string;
    tables: string[];
    migrations: { hash: string; createdAt: string }[];
  };
  journal: { sourceId: string; head: string; floor: string };
  dump: BundleFile;
  photos: (BundleFile & { key: string })[];
};
export type CaptureBundleOptions = {
  pool: Pool;
  storage: ObjectStorage;
  root: string;
  source: string;
  writersStopped: true;
  deadlineMs?: number;
  // Must honour signal, terminate AND reap the child before settling. Never
  // include connection credentials or stderr in the thrown error.
  dump: (snapshot: string, path: string, signal: AbortSignal) => Promise<void>;
};

async function fingerprint(path: string, limit: number): Promise<BundleFile> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o600 ||
      before.size < 1 ||
      before.size > limit
    )
      throw new Error("Invalid bundle file");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false }))
      hash.update(chunk);
    const after = await file.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error("Bundle file changed");
    return {
      path: basename(path),
      bytes: before.size,
      sha256: hash.digest("hex"),
    };
  } finally {
    await file.close();
  }
}

/**
 * Capture a raw PostgreSQL dump and only retained ready encounter renditions.
 * The operator MUST stop HTTP writers, workers, maintenance and migrations,
 * and drain in-flight storage calls BEFORE invoking this function. SQL locks
 * cannot stop an upload/delete already in flight in the object provider.
 * This private plaintext staging bundle must be encrypted before retention;
 * restoration additionally requires reconciliation with the later independent
 * decision journal and revocation/sanitisation. This function does not restore.
 */
export async function captureBundle(
  options: CaptureBundleOptions,
): Promise<BundleManifest> {
  const { pool, storage, root, source, dump } = options;
  const deadlineMs = options.deadlineMs ?? maximumDeadlineMs;
  if (
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > maximumDeadlineMs
  )
    throw new Error("Invalid capture deadline");
  if (options.writersStopped !== true)
    throw new Error("Stopped writers required");
  if (typeof source !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(source))
    throw new Error("Invalid source identity");
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root === "/" ||
    (await realpath(dirname(root))) !== dirname(root)
  )
    throw new Error("Canonical bundle root required");
  await mkdir(root, { mode: 0o700 }); // Never reuse or clean an occupied target.
  const created = await lstat(root);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  timer.unref();
  function checkDeadline() {
    if (controller.signal.aborted)
      throw new Error("Bundle capture deadline exceeded");
  }
  let client: PoolClient | undefined;
  let inTransaction = false;
  let failed = true;
  try {
    await chmod(root, 0o700);
    client = await pool.connect();
    checkDeadline();
    await client.query("begin isolation level repeatable read");
    inTransaction = true;
    await client.query("set local lock_timeout='3s'");
    await client.query("set local statement_timeout='30s'");
    await client.query("set local idle_in_transaction_session_timeout='11min'");
    const version = (await client.query("show server_version_num")).rows[0]
      .server_version_num;
    if (Math.floor(Number(version) / 10000) !== 17)
      throw new Error("PostgreSQL 17 required");
    if (
      !(
        await client.query(
          "select pg_try_advisory_xact_lock(1296646485,6) locked",
        )
      ).rows[0].locked
    )
      throw new Error("Concurrent schema migration");
    await client.query(
      `lock table ${tables.map((name) => `"${name}"`).join(",")} in exclusive mode`,
    );
    const columns = (
      await client.query(
        "select table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
      )
    ).rows;
    const actualTables = [
      ...new Set(columns.map((row) => String(row.table_name))),
    ].sort();
    if (JSON.stringify(actualTables) !== JSON.stringify(tables))
      throw new Error("Unexpected source schema");
    const constraints = (
      await client.query(
        "select conrelid::regclass::text name,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by conrelid::regclass::text,conname",
      )
    ).rows;
    const migrationRows = (
      await client.query(
        "select hash,created_at::text from drizzle.__drizzle_migrations order by id",
      )
    ).rows;
    if (
      !migrationRows.length ||
      migrationRows.some(
        (row) =>
          !/^[a-f0-9]{64}$/.test(row.hash) || !/^[0-9]+$/.test(row.created_at),
      )
    )
      throw new Error("Invalid migration inventory");
    const state = (
      await client.query(
        "select source_id,head::text,floor::text from recovery_state where singleton",
      )
    ).rows;
    if (
      state.length !== 1 ||
      !uuid.test(state[0].source_id) ||
      !/^(0|[1-9][0-9]*)$/.test(state[0].head) ||
      !/^(0|[1-9][0-9]*)$/.test(state[0].floor) ||
      BigInt(state[0].floor) > BigInt(state[0].head)
    )
      throw new Error("Invalid recovery state");
    const manifest: BundleManifest = {
      version: 1,
      kind: "miaou-remote-backup-bundle",
      id: randomUUID(),
      source,
      capturedAt: new Date().toISOString(),
      postgresMajor: 17,
      schema: {
        signature: createHash("sha256")
          .update(
            JSON.stringify({ columns, constraints, migrations: migrationRows }),
          )
          .digest("hex"),
        tables: [...tables],
        migrations: migrationRows.map((row) => ({
          hash: row.hash,
          createdAt: row.created_at,
        })),
      },
      journal: {
        sourceId: state[0].source_id,
        head: state[0].head,
        floor: state[0].floor,
      },
      dump: { path: "database.dump", bytes: 0, sha256: "" },
      photos: [],
    };
    const snapshot = (
      await client.query("select pg_export_snapshot() snapshot")
    ).rows[0].snapshot as string;
    if (!/^[a-fA-F0-9-]+$/.test(snapshot))
      throw new Error("Invalid exported snapshot");
    checkDeadline();
    await dump(snapshot, join(root, "database.dump"), controller.signal);
    checkDeadline();
    manifest.dump = await fingerprint(
      join(root, "database.dump"),
      maxDumpBytes,
    );
    const retained = (
      await client.query(
        "select m.id from media m where m.state='ready' and exists(select 1 from encounter e where e.media_id=m.id and e.deleted_at is null) order by m.id",
      )
    ).rows;
    let total = 0;
    for (const row of retained) {
      const id = String(row.id);
      if (!uuid.test(id)) throw new Error("Invalid retained media identity");
      await mkdir(join(root, id), { mode: 0o700 });
      for (const suffix of ["image.webp", "thumb.webp"]) {
        checkDeadline();
        const key = `${id}/${suffix}`;
        const bytes = await new Promise<Buffer>((fulfil, reject) => {
          const abort = () =>
            reject(new Error("Bundle capture deadline exceeded"));
          controller.signal.addEventListener("abort", abort, { once: true });
          storage
            .get(key)
            .then(fulfil, reject)
            .finally(() =>
              controller.signal.removeEventListener("abort", abort),
            );
        });
        checkDeadline();
        total += bytes.length;
        if (
          !bytes.length ||
          bytes.length > maxPhotoBytes ||
          total > maxTotalPhotoBytes
        )
          throw new Error("Bundle photo limit exceeded");
        await writeFile(join(root, key), bytes, { mode: 0o600, flag: "wx" });
        const file = await fingerprint(join(root, key), maxPhotoBytes);
        manifest.photos.push({ ...file, path: key, key });
      }
    }
    checkDeadline();
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify(manifest) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await client.query("commit");
    inTransaction = false;
    failed = false;
    return manifest;
  } catch {
    // Adapters may throw provider/connection details: never propagate them.
    throw new Error("Bundle capture failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (client) {
      let destroy = false;
      if (inTransaction) {
        try {
          await client.query("rollback");
        } catch {
          destroy = true;
        }
      }
      client.release(destroy);
    }
    if (failed) {
      const current = await lstat(root).catch(() => undefined);
      if (
        current?.ino === created.ino &&
        current.dev === created.dev &&
        current.isDirectory()
      )
        await rm(root, { recursive: true, force: true });
    }
  }
}
