// Local synthetic operations only. No scheduler or remote alert delivery.
import { createHash, randomUUID } from "node:crypto";
import { readdir, rename, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Pool } from "pg";
import type { ObjectStorage } from "../encounters/storage.js";
import {
  backupInput,
  captureBackup,
  local,
  seal,
  unseal,
  type Backup,
} from "./recovery.js";
import {
  copyJournal,
  readJournal,
  latestAnchor,
  directory,
  readPrivate,
  syncDirectory,
  writeJournalFile,
} from "./decision-journal.js";
const lifetime = 30 * 86400000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sequence = /^(0|[1-9][0-9]*)$/;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
type Entry = {
  id: string;
  capturedAt: string;
  digest: string;
  phase: "backup_pending" | "retained" | "deleting";
  pendingCopy: string | null;
  latest: { id: string; through: string; at: string } | null;
};
type Code = "started" | "succeeded" | "failed";
export type Catalog = {
  version: 1;
  kind: "local-synthetic-recovery-catalog";
  sourceDatabase: string;
  sourceId: string;
  anchorDirectoryId: string;
  journalKeyId: string;
  last: { id: string; action: Action; code: Code } | null;
  backups: Entry[];
};
export type Action = "backup" | "copy" | "status" | "rotate";
export type RecoveryOptions = {
  root: string;
  anchors: string;
  backupKey: Buffer;
  journalKey: Buffer;
  // Same exclusive writer as the existing journal; seam for real I/O failures.
  write?: typeof writeJournalFile;
};
export type RecoveryStatus = {
  id: string;
  code:
    | "current"
    | "journal_missing"
    | "journal_behind"
    | "expired"
    | "interrupted";
  copyId?: string;
  copiedThrough?: string;
  copiedAt?: string;
  uncopiedAfterCut: "unknown";
};
function validate(input: unknown): Catalog {
  const c = input as Catalog;
  if (
    !c ||
    c.version !== 1 ||
    c.kind !== "local-synthetic-recovery-catalog" ||
    typeof c.sourceDatabase !== "string" ||
    !uuid.test(c.sourceId) ||
    !/^[a-f0-9]{64}$/.test(c.anchorDirectoryId) ||
    !/^[a-f0-9]{64}$/.test(c.journalKeyId) ||
    !Array.isArray(c.backups) ||
    (c.last !== null &&
      (!c.last ||
        !uuid.test(c.last.id) ||
        !["backup", "copy", "status", "rotate"].includes(c.last.action) ||
        !["started", "succeeded", "failed"].includes(c.last.code)))
  )
    throw new Error("Invalid recovery catalog");
  const ids = new Set<string>();
  for (const b of c.backups) {
    if (
      !b ||
      !uuid.test(b.id) ||
      ids.has(b.id) ||
      !Number.isFinite(Date.parse(b.capturedAt)) ||
      Date.parse(b.capturedAt) > Date.now() + 1000 ||
      !/^[a-f0-9]{64}$/.test(b.digest) ||
      !["backup_pending", "retained", "deleting"].includes(b.phase) ||
      (b.pendingCopy !== null && !uuid.test(b.pendingCopy)) ||
      (b.latest !== null &&
        (!b.latest ||
          !uuid.test(b.latest.id) ||
          !sequence.test(b.latest.through) ||
          !Number.isFinite(Date.parse(b.latest.at))))
    )
      throw new Error("Invalid recovery entry");
    ids.add(b.id);
  }
  return c;
}
export async function runRecovery(
  pool: Pool,
  storage: ObjectStorage,
  action: Action,
  options: RecoveryOptions,
) {
  if (!["backup", "copy", "status", "rotate"].includes(action))
    throw new Error("Local recovery action required");
  if (
    options.backupKey.length !== 32 ||
    options.journalKey.length !== 32 ||
    options.backupKey.equals(options.journalKey)
  )
    throw new Error("Independent recovery keys required");
  const root = resolve(options.root),
    anchors = resolve(options.anchors);
  if (
    root === anchors ||
    root.startsWith(anchors + sep) ||
    anchors.startsWith(root + sep)
  )
    throw new Error("Independent recovery directories required");
  await directory(root);
  await directory(anchors);
  const archives = await directory(join(root, "backups"));
  const copies = await directory(join(root, "copies"));
  const file = join(root, "state.enc"),
    write = options.write ?? writeJournalFile;
  const sourceDatabase = await local(pool);
  const state = (
    await pool.query(
      "select source_id,head::text from recovery_state where singleton",
    )
  ).rows[0];
  if (!state) throw new Error("Recovery source required");
  // Session lock automatically releases on process loss. The catalog binds the
  // directory to one source before any mutable state is written.
  const c = await pool.connect();
  let catalog: Catalog | undefined;
  let held = false;
  async function save() {
    const temporary = join(root, randomUUID() + ".state.tmp");
    await write(temporary, seal(catalog, options.backupKey));
    await rename(temporary, file);
    await syncDirectory(root);
  }
  const backupPath = (b: Entry) => join(archives, b.id + ".enc");
  const copyPath = (b: Entry, id: string) =>
    join(copies, b.id + "." + id + ".enc");
  async function backup(b: Entry): Promise<Backup> {
    const bytes = await readPrivate(backupPath(b));
    if (hash(bytes) !== b.digest) throw new Error("Backup digest mismatch");
    const value = backupInput(unseal(bytes, options.backupKey));
    if (
      value.id !== b.id ||
      value.capturedAt !== b.capturedAt ||
      value.sourceDatabase !== catalog!.sourceDatabase ||
      value.journal.sourceId !== catalog!.sourceId
    )
      throw new Error("Backup catalog mismatch");
    return value;
  }
  async function adopt(b: Entry, value: Backup, id: string) {
    const copy = await readJournal(
      value,
      copyPath(b, id),
      anchors,
      options.journalKey,
    );
    b.latest = { id, through: copy.end, at: copy.copiedAt };
    b.pendingCopy = null;
    b.phase = "retained";
    await save();
  }
  async function remove(path: string) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async function pruneCopies(b: Entry, expired: boolean) {
    // Never discard a previous usable cut before a new cut is authenticated.
    if (!expired) {
      if (!b.latest) return;
      await readJournal(
        await backup(b),
        copyPath(b, b.latest.id),
        anchors,
        options.journalKey,
      );
    }
    for (const name of await readdir(copies)) {
      if (!name.startsWith(b.id + ".")) continue;
      if (!new RegExp(`^${b.id}\\.[a-f0-9-]{36}\\.enc$`).test(name))
        throw new Error("Unexpected copy file");
      if (!expired && name === b.id + "." + b.latest!.id + ".enc") continue;
      await remove(join(copies, name));
    }
    await syncDirectory(copies);
    for (const name of await readdir(anchors)) {
      if (!name.startsWith(b.id + ".")) continue;
      if (!new RegExp(`^${b.id}\\.(0|[1-9][0-9]*)\\.anchor$`).test(name))
        throw new Error("Unexpected anchor file");
      if (!expired && name === b.id + "." + b.latest!.through + ".anchor")
        continue;
      await remove(join(anchors, name));
    }
    await syncDirectory(anchors);
  }
  async function rotate() {
    for (const b of [...catalog!.backups]) {
      if (
        b.phase === "deleting" ||
        Date.now() - Date.parse(b.capturedAt) >= lifetime
      ) {
        if (
          b.phase !== "deleting" &&
          (await readdir(archives)).includes(b.id + ".enc")
        ) {
          await backup(b); // Authenticate the original date before starting expiry.
        }
        b.phase = "deleting";
        await save();
        await remove(backupPath(b));
        await syncDirectory(archives);
        await pruneCopies(b, true);
        catalog!.backups = catalog!.backups.filter((e) => e.id !== b.id);
        await save();
      } else if (!b.pendingCopy) await pruneCopies(b, false);
    }
  }
  async function copy(b: Entry) {
    const value = await backup(b);
    // Recover a crash after publication, before catalog confirmation.
    if (b.pendingCopy) {
      const pending = copyPath(b, b.pendingCopy);
      const exists = (await readdir(copies)).includes(
        pending.split(sep).at(-1)!,
      );
      if (exists) {
        const anchor = await latestAnchor(anchors, options.journalKey, value);
        if (
          anchor &&
          (!b.latest || BigInt(anchor.end) > BigInt(b.latest.through))
        ) {
          await adopt(b, value, b.pendingCopy);
        } else {
          // Unconfirmed orphan: preserve it until a new copy has a valid anchor.
          if (b.latest)
            await readJournal(
              value,
              copyPath(b, b.latest.id),
              anchors,
              options.journalKey,
            );
          b.pendingCopy = null;
          await save();
        }
      } else {
        // An anchor with no copy must not be silently superseded.
        if (b.latest)
          await readJournal(
            value,
            copyPath(b, b.latest.id),
            anchors,
            options.journalKey,
          );
        else if (
          (await readdir(anchors)).some((name) => name.startsWith(b.id + "."))
        )
          throw new Error("Missing published journal copy");
        b.pendingCopy = null;
        await save();
      }
    }
    if (b.latest) {
      const latest = await readJournal(
        value,
        copyPath(b, b.latest.id),
        anchors,
        options.journalKey,
      );
      if (latest.end !== b.latest.through || latest.copiedAt !== b.latest.at)
        throw new Error("Copy catalog mismatch");
    }
    const head = (
      await pool.query("select head::text from recovery_state where singleton")
    ).rows[0].head as string;
    if (b.latest && BigInt(head) < BigInt(b.latest.through))
      throw new Error("Source journal rollback");
    if (b.latest && head === b.latest.through) {
      b.phase = "retained";
      return;
    }
    b.pendingCopy = randomUUID();
    await save();
    await copyJournal(
      pool,
      value,
      copyPath(b, b.pendingCopy),
      anchors,
      options.journalKey,
      write,
    );
    await adopt(b, value, b.pendingCopy);
  }
  try {
    held = (
      await c.query(
        "select pg_try_advisory_lock(hashtextextended($1,0)) held",
        ["recovery-ops:" + root],
      )
    ).rows[0].held;
    if (!held) throw new Error("Recovery operation busy");
    if (!(await readdir(root)).includes("state.enc")) {
      const initial: Catalog = {
        version: 1,
        kind: "local-synthetic-recovery-catalog",
        sourceDatabase,
        sourceId: state.source_id,
        anchorDirectoryId: hash(Buffer.from(anchors)),
        journalKeyId: hash(options.journalKey),
        last: null,
        backups: [],
      };
      try {
        await writeJournalFile(file, seal(initial, options.backupKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    catalog = validate(unseal(await readPrivate(file), options.backupKey));
    if (
      catalog.sourceDatabase !== sourceDatabase ||
      catalog.sourceId !== state.source_id ||
      catalog.anchorDirectoryId !== hash(Buffer.from(anchors)) ||
      catalog.journalKeyId !== hash(options.journalKey)
    )
      throw new Error("Recovery catalog source mismatch");
    // No arbitrary files are adopted or purged. A catalog lost independently
    // from the artifacts must be handled explicitly, never treated as empty.
    for (const name of await readdir(archives)) {
      if (!catalog.backups.some((b) => name === b.id + ".enc"))
        throw new Error("Untracked backup file");
    }
    for (const name of [
      ...(await readdir(copies)),
      ...(await readdir(anchors)),
    ]) {
      if (!catalog.backups.some((b) => name.startsWith(b.id + ".")))
        throw new Error("Untracked journal file");
    }
    for (const name of await readdir(root)) {
      if (/^[a-f0-9-]{36}\.state\.tmp$/.test(name))
        await remove(join(root, name));
    }
    await syncDirectory(root);
    catalog.last = { id: randomUUID(), action, code: "started" };
    await save();
    if (action === "backup") {
      for (const b of [...catalog.backups]) {
        if (b.phase !== "backup_pending" || b.pendingCopy || b.latest) continue;
        const exists = (await readdir(archives)).includes(b.id + ".enc");
        if (exists && hash(await readPrivate(backupPath(b))) === b.digest)
          continue;
        // Only an unpublished intent with no journal artifacts can be dropped.
        // A partial exclusive write after process loss never became usable.
        if (
          [...(await readdir(copies)), ...(await readdir(anchors))].some(
            (name) => name.startsWith(b.id + "."),
          )
        )
          throw new Error("Unexpected unpublished journal artifacts");
        await remove(backupPath(b));
        await syncDirectory(archives);
        catalog.backups = catalog.backups.filter((e) => e.id !== b.id);
        await save();
      }
    }
    if (action !== "status") await rotate();
    if (action === "backup") {
      // Complete published archives resume copying; no existing archive is overwritten.
      for (const b of catalog.backups) await copy(b);
      const value = await captureBackup(pool, storage),
        bytes = seal(value, options.backupKey);
      const b: Entry = {
        id: value.id,
        capturedAt: value.capturedAt,
        digest: hash(bytes),
        phase: "backup_pending",
        pendingCopy: null,
        latest: null,
      };
      catalog.backups.push(b);
      await save();
      await write(backupPath(b), bytes);
      await copy(b);
    } else if (action === "copy") {
      for (const b of catalog.backups) await copy(b);
    }
    if (action === "backup" || action === "copy") await rotate();
    const head = (
      await pool.query("select head::text from recovery_state where singleton")
    ).rows[0].head as string;
    const results: RecoveryStatus[] = [];
    for (const b of catalog.backups) {
      let code: RecoveryStatus["code"];
      if (
        b.phase === "deleting" ||
        Date.now() - Date.parse(b.capturedAt) >= lifetime
      )
        code = "expired";
      else if (b.phase === "backup_pending" && !b.pendingCopy && !b.latest)
        code = "interrupted";
      else {
        const value = await backup(b);
        if (b.pendingCopy || b.phase === "backup_pending") code = "interrupted";
        else if (
          !b.latest ||
          !(await readdir(copies)).includes(b.id + "." + b.latest.id + ".enc")
        )
          code = "journal_missing";
        else {
          const latest = await readJournal(
            value,
            copyPath(b, b.latest.id),
            anchors,
            options.journalKey,
          );
          if (
            latest.end !== b.latest.through ||
            latest.copiedAt !== b.latest.at ||
            BigInt(head) < BigInt(latest.end)
          )
            throw new Error("Journal state mismatch");
          code = head === latest.end ? "current" : "journal_behind";
        }
      }
      results.push({
        id: b.id,
        code,
        ...(b.latest
          ? {
              copyId: b.latest.id,
              copiedThrough: b.latest.through,
              copiedAt: b.latest.at,
            }
          : {}),
        uncopiedAfterCut: "unknown",
      });
    }
    const ok =
      (results.length > 0 || action === "rotate") &&
      results.every((r) => r.code === "current");
    catalog.last.code = ok ? "succeeded" : "failed";
    await save();
    return {
      code: ok
        ? action === "rotate"
          ? "rotation_completed"
          : "recovery_current"
        : "recovery_attention",
      backups: results,
    };
  } catch (error) {
    if (
      catalog &&
      held &&
      catalog.sourceDatabase === sourceDatabase &&
      catalog.sourceId === state.source_id &&
      catalog.anchorDirectoryId === hash(Buffer.from(anchors)) &&
      catalog.journalKeyId === hash(options.journalKey)
    ) {
      catalog.last = {
        id: catalog.last?.id ?? randomUUID(),
        action,
        code: "failed",
      };
      await save();
    }
    throw error;
  } finally {
    if (held)
      await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        "recovery-ops:" + root,
      ]);
    c.release();
  }
}
