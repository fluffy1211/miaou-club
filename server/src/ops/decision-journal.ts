import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, realpath, readdir, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Pool } from "pg";
import {
  backupInput,
  local,
  locked,
  seal,
  unseal,
  restoreBackup,
  type Backup,
  type Decisions,
  RecoveryStorage,
} from "./recovery.js";

const codes = [
  "user_remove",
  "user_suspend",
  "user_withdraw",
  "user_demote",
  "credentials_revoke",
  "encounter_remove",
  "encounter_hide",
  "encounter_private",
  "location_remove",
  "friendship_remove",
  "report_remove",
  "report_close",
] as const;
type Code = (typeof codes)[number];
type Event = { seq: string; code: Code; subject: string; createdAt: string };
type Copy = {
  version: 1;
  kind: "local-synthetic-journal";
  backupId: string;
  sourceId: string;
  sourceDatabase: string;
  start: string;
  end: string;
  copiedAt: string;
  events: Event[];
};
type Anchor = Omit<Copy, "events" | "kind"> & {
  kind: "local-synthetic-journal-anchor";
  digest: string;
};
const sequence = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function retained(b: Backup) {
  const age = Date.now() - Date.parse(b.capturedAt);
  if (age < -1000 || age > 30 * 86400000)
    throw new Error("Retained backup required");
}
function linked(c: Omit<Copy, "events" | "kind">, b: Backup) {
  retained(b);
  if (
    !c ||
    c.version !== 1 ||
    c.backupId !== b.id ||
    c.sourceId !== b.journal.sourceId ||
    c.sourceDatabase !== b.sourceDatabase ||
    c.start !== b.journal.head ||
    !sequence(c.start) ||
    !sequence(c.end) ||
    BigInt(c.end) < BigInt(c.start) ||
    !Number.isFinite(Date.parse(c.copiedAt)) ||
    Date.parse(c.copiedAt) < Date.parse(b.capturedAt) ||
    Date.parse(c.copiedAt) > Date.now() + 1000
  )
    throw new Error("Journal linkage mismatch");
}
function validate(input: unknown, b: Backup): Copy {
  const c = input as Copy;
  linked(c, b);
  if (c.kind !== "local-synthetic-journal" || !Array.isArray(c.events))
    throw new Error("Journal inventory required");
  let expected = BigInt(c.start);
  for (const e of c.events) {
    if (
      !e ||
      Object.keys(e).sort().join() !== "code,createdAt,seq,subject" ||
      !sequence(e.seq) ||
      BigInt(e.seq) !== ++expected ||
      !codes.includes(e.code) ||
      typeof e.subject !== "string" ||
      !e.subject.length ||
      e.subject.length > 256
    )
      throw new Error("Invalid or gapped journal");
    if (
      !Number.isFinite(Date.parse(e.createdAt)) ||
      Date.parse(e.createdAt) > Date.parse(c.copiedAt)
    )
      throw new Error("Invalid journal timestamp");
  }
  if (expected !== BigInt(c.end)) throw new Error("Incomplete journal");
  return c;
}
async function directory(path: string) {
  const root = resolve(path);
  if (
    !root.startsWith("/private/tmp/") &&
    !root.startsWith(resolve(process.cwd(), ".cache") + sep)
  )
    throw new Error("Isolated local journal directory required");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await realpath(root)) !== root)
    throw new Error("Journal symlinks forbidden");
  const handle = await open(root, constants.O_RDONLY);
  try {
    const stat = await handle.stat();
    if (!stat.isDirectory() || stat.mode & 0o077)
      throw new Error("Private journal directory required");
  } finally {
    await handle.close();
  }
  return root;
}
async function syncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
// Exclusive immutable files; partial writes are removed so the same cut can retry.
export async function writeJournalFile(path: string, bytes: Buffer) {
  const parent = await directory(dirname(path));
  const handle = await open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await syncDirectory(parent);
  } catch (error) {
    await unlink(path);
    await syncDirectory(parent);
    throw error;
  } finally {
    await handle.close();
  }
}
async function readPrivate(path: string) {
  await directory(dirname(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mode & 0o077)
      throw new Error("Private journal file required");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function latestAnchor(
  path: string,
  key: Buffer,
  b: Backup,
): Promise<Anchor | undefined> {
  const root = await directory(path);
  let latest: Anchor | undefined;
  for (const file of await readdir(root)) {
    if (!file.startsWith(b.id + ".")) continue;
    const a = unseal<Anchor>(await readPrivate(join(root, file)), key);
    linked(a, b);
    if (
      a.kind !== "local-synthetic-journal-anchor" ||
      !/^[a-f0-9]{64}$/.test(a.digest) ||
      file !== `${b.id}.${a.end}.anchor`
    )
      throw new Error("Invalid journal anchor");
    if (!latest || BigInt(a.end) > BigInt(latest.end)) latest = a;
  }
  return latest;
}
function independent(file: string, anchors: string) {
  const a = resolve(dirname(file)),
    b = resolve(anchors);
  if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep))
    throw new Error("Separate journal and anchor directories required");
}
export async function copyJournal(
  pool: Pool,
  input: unknown,
  file: string,
  anchors: string,
  key: Buffer,
  write: typeof writeJournalFile = writeJournalFile,
) {
  const b = backupInput(input);
  independent(file, anchors);
  if ((await local(pool)) !== b.sourceDatabase)
    throw new Error("Journal source database mismatch");
  return locked(pool, async (c) => {
    const state = (
      await c.query(
        "select source_id,head::text,floor::text from recovery_state where singleton",
      )
    ).rows[0];
    if (
      !state ||
      state.source_id !== b.journal.sourceId ||
      BigInt(state.floor) > BigInt(b.journal.head)
    )
      throw new Error("Missing retained source journal");
    const events = (
      await c.query(
        'select seq::text,code,subject,created_at as "createdAt" from recovery_decision where seq>$1 order by recovery_decision.seq',
        [b.journal.head],
      )
    ).rows.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })) as Event[];
    const copy = validate(
      {
        version: 1,
        kind: "local-synthetic-journal",
        backupId: b.id,
        sourceId: state.source_id,
        sourceDatabase: b.sourceDatabase,
        start: b.journal.head,
        end: state.head,
        copiedAt: (
          await c.query("select clock_timestamp() as stamp")
        ).rows[0].stamp.toISOString(),
        events,
      },
      b,
    );
    const previous = await latestAnchor(anchors, key, b);
    if (previous && BigInt(previous.end) >= BigInt(copy.end))
      throw new Error("No newer journal cut");
    const bytes = seal(copy, key);
    await write(file, bytes);
    const { events: _events, kind: _kind, ...metadata } = copy;
    const anchor: Anchor = {
      ...metadata,
      kind: "local-synthetic-journal-anchor",
      digest: digest(bytes),
    };
    try {
      await write(
        join(anchors, `${b.id}.${copy.end}.anchor`),
        seal(anchor, key),
      );
    } catch (error) {
      await unlink(file);
      await syncDirectory(dirname(file));
      throw error;
    }
    return {
      copiedThrough: copy.end,
      copiedAt: copy.copiedAt,
      uncopiedAfterCut: "unknown" as const,
    };
  });
}
export async function readJournal(
  input: unknown,
  file: string,
  anchors: string,
  key: Buffer,
) {
  const b = backupInput(input);
  independent(file, anchors);
  const bytes = await readPrivate(file),
    latest = await latestAnchor(anchors, key, b);
  if (!latest || latest.digest !== digest(bytes))
    throw new Error("Latest independent journal anchor required");
  const copy = validate(unseal(bytes, key), b);
  if (copy.end !== latest.end || copy.copiedAt !== latest.copiedAt)
    throw new Error("Journal anchor mismatch");
  return copy;
}
function replay(b: Backup, c: Copy): Decisions {
  const d: Decisions = {
    version: 1,
    kind: "local-synthetic-decisions",
    backupId: b.id,
    sourceDatabase: b.sourceDatabase,
    capturedAt: new Date().toISOString(),
    removedUsers: [],
    removedEncounters: [],
    removedFriendships: [],
    revokedCredentials: [],
    removedReports: [],
    closedReports: [],
    policies: b.tables.user_policy.map((p) => ({
      user_id: p.user_id,
      status: p.status,
      role: p.role,
    })),
    encounters: b.tables.encounter.map((e) => ({
      id: e.id,
      hidden: e.hidden,
      visibility: e.visibility,
      location_size: e.location_size,
      location_x: e.location_x,
      location_y: e.location_y,
      location_context: e.location_context,
    })),
  };
  for (const e of c.events) {
    const policy = d.policies.find((p) => p.user_id === e.subject),
      encounter = d.encounters.find((p) => p.id === e.subject);
    switch (e.code) {
      case "user_remove":
        d.removedUsers.push(e.subject);
        break;
      case "user_suspend":
        if (
          policy &&
          policy.status !== "withdrawn" &&
          policy.status !== "deleting"
        )
          policy.status = "suspended";
        break;
      case "user_withdraw":
        if (policy && policy.status !== "deleting") policy.status = "withdrawn";
        break;
      case "user_demote":
        if (policy) policy.role = "user";
        break;
      case "credentials_revoke":
        d.revokedCredentials.push(e.subject);
        break;
      case "encounter_remove":
        d.removedEncounters.push(e.subject);
        break;
      case "encounter_hide":
        if (encounter) encounter.hidden = true;
        break;
      case "encounter_private":
        if (encounter) encounter.visibility = "private";
        break;
      case "location_remove":
        if (encounter)
          for (const field of [
            "location_size",
            "location_x",
            "location_y",
            "location_context",
          ])
            encounter[field] = null;
        break;
      case "friendship_remove":
        d.removedFriendships.push(e.subject);
        break;
      case "report_remove":
        d.removedReports.push(e.subject);
        break;
      case "report_close":
        if (
          !d.closedReports.some((r) => r.id === e.subject) &&
          b.tables.report.some((r) => r.id === e.subject && !r.closed_at)
        )
          d.closedReports.push({ id: e.subject, closed_at: e.createdAt });
        break;
    }
  }
  return d;
}
export async function restoreJournal(
  pool: Pool,
  storage: RecoveryStorage,
  input: unknown,
  file: string,
  anchors: string,
  key: Buffer,
) {
  const b = backupInput(input),
    c = await readJournal(b, file, anchors, key);
  const result = await restoreBackup(pool, storage, b, replay(b, c));
  return {
    ...result,
    copiedThrough: c.end,
    copiedAt: c.copiedAt,
    uncopiedAfterCut: "unknown" as const,
  };
}
