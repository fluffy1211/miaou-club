// Local synthetic rehearsal only. No production backup or remote recovery API.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { mkdir, readdir, realpath, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { LocalStorage, type ObjectStorage } from "../encounters/storage.js";
type Row = Record<string, unknown>;
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
];
const transient = new Set([
  "session",
  "session_security",
  "verification",
  "report_consultation",
  "data_export",
]);
// Dedicated empty local namespace; never write recovered objects over live files.
export class RecoveryStorage extends LocalStorage {
  constructor(private recoveryRoot: string) {
    super(recoveryRoot);
    const root = resolve(recoveryRoot);
    if (
      !root.startsWith("/private/tmp/") &&
      !root.startsWith(resolve(process.cwd(), ".cache") + "/")
    )
      throw new Error("Local recovery namespace required");
  }
  async assertEmpty() {
    await mkdir(this.recoveryRoot, { recursive: true, mode: 0o700 });
    if (
      (await lstat(this.recoveryRoot)).isSymbolicLink() ||
      (await realpath(this.recoveryRoot)) !== resolve(this.recoveryRoot)
    )
      throw new Error("Recovery symlinks forbidden");
    async function check(path: string): Promise<void> {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (!entry.isDirectory())
          throw new Error("Empty recovery object namespace required");
        await check(join(path, entry.name));
      }
    }
    await check(this.recoveryRoot);
  }
}
function credentialFingerprint(
  accounts: Row[],
  factors: Row[],
  owner: unknown,
) {
  const rows = accounts
    .filter((r) => r.user_id === owner)
    .map((r) => [r.id, r.provider_id, r.account_id, r.password])
    .sort();
  const mfa = factors
    .filter((r) => r.user_id === owner)
    .map((r) => [r.id, r.secret, r.backup_codes])
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({ rows, mfa }))
    .digest("hex");
}
const day = 86400000;
export type Backup = {
  version: 1;
  kind: "local-synthetic-backup";
  id: string;
  sourceDatabase: string;
  capturedAt: string;
  schema: string;
  journal: { sourceId: string; head: string };
  tables: Record<string, Row[]>;
  objects: Record<string, string>;
};
export type Decisions = {
  version: 1;
  kind: "local-synthetic-decisions";
  backupId: string;
  sourceDatabase: string;
  capturedAt: string;
  removedUsers: string[];
  removedEncounters: string[];
  removedFriendships: string[];
  policies: Row[];
  encounters: Row[];
  revokedCredentials: string[];
  removedReports: string[];
  closedReports: { id: string; closed_at: string }[];
};
export function assertLocalTestDatabase(url: string) {
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !/^\/[a-z0-9_]+_test$/.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Local synthetic test database required");
}
export async function local(pool: Pool) {
  const connectionString = pool.options.connectionString;
  if (!connectionString) throw new Error("Explicit test connection required");
  assertLocalTestDatabase(connectionString);
  const database = (await pool.query("select current_database() name")).rows[0]
    .name as string;
  if (new URL(connectionString).pathname !== "/" + database)
    throw new Error("Database identity mismatch");
  return database;
}
export function seal(value: unknown, key: Buffer) {
  if (key.length !== 32) throw new Error("32-byte recovery key required");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("miaou-local-recovery-v1"));
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from("MCR1"), iv, cipher.getAuthTag(), payload]);
}
export function unseal<T = unknown>(bytes: Buffer, key: Buffer): T {
  if (
    key.length !== 32 ||
    bytes.length < 33 ||
    bytes.subarray(0, 4).toString() !== "MCR1"
  )
    throw new Error("Invalid recovery archive");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(4, 16));
  decipher.setAAD(Buffer.from("miaou-local-recovery-v1"));
  decipher.setAuthTag(bytes.subarray(16, 32));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(32)),
      decipher.final(),
    ]).toString(),
  ) as T;
}
async function signature(c: PoolClient) {
  const columns = (
    await c.query(
      `select table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
    )
  ).rows;
  const names = [...new Set(columns.map((r) => r.table_name as string))].sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify([...tables, "recovery_state", "recovery_decision"].sort())
  )
    throw new Error("Recovery inventory does not match schema");
  const constraints = (
    await c.query(
      `select conrelid::regclass::text name,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by conrelid::regclass::text,conname`,
    )
  ).rows;
  const migrations = (
    await c.query("select hash from drizzle.__drizzle_migrations order by id")
  ).rows;
  return createHash("sha256")
    .update(JSON.stringify({ columns, constraints, migrations }))
    .digest("hex");
}
export async function locked<T>(
  pool: Pool,
  run: (c: PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("begin isolation level repeatable read");
    await c.query("set local lock_timeout='3s'");
    await c.query(
      `lock table ${[...tables, "recovery_state", "recovery_decision"].map((t) => '"' + t + '"').join(",")} in exclusive mode`,
    );
    const value = await run(c);
    await c.query("commit");
    return value;
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
export async function captureBackup(
  pool: Pool,
  storage: ObjectStorage,
): Promise<Backup> {
  const sourceDatabase = await local(pool);
  return locked(pool, async (c) => {
    const backup: Backup = {
      version: 1,
      kind: "local-synthetic-backup",
      id: randomUUID(),
      sourceDatabase,
      capturedAt: new Date().toISOString(),
      schema: await signature(c),
      journal: await journalWatermark(c),
      tables: {},
      objects: {},
    };
    for (const table of tables) {
      backup.tables[table] = transient.has(table)
        ? []
        : (
            await c.query(`select row_to_json(t) row from "${table}" t`)
          ).rows.map((r) => r.row as Row);
    }
    const kept = new Set(
      backup.tables.encounter
        .filter((r) => !r.deleted_at)
        .map((r) => r.media_id),
    );
    for (const media of backup.tables.media) {
      media.original_present = false;
      if (media.state === "ready" && kept.has(media.id)) {
        for (const suffix of ["image.webp", "thumb.webp"]) {
          const key = media.id + "/" + suffix;
          backup.objects[key] = (await storage.get(key)).toString("base64");
        }
      } else if (media.state !== "deleted") {
        media.state = "deleting";
        media.next_attempt_at = backup.capturedAt;
      }
    }
    // Revoked OAuth bearer tokens must not become usable after recovery.
    for (const account of backup.tables.account)
      for (const name of ["access_token", "refresh_token", "id_token"])
        account[name] = null;
    return backup;
  });
}
export function backupInput(input: unknown): Backup {
  const b = input as Backup;
  if (
    !b ||
    b.version !== 1 ||
    b.kind !== "local-synthetic-backup" ||
    !/^[a-f0-9-]{36}$/.test(b.id) ||
    !b.tables ||
    !b.objects ||
    !b.journal ||
    !/^[a-f0-9-]{36}$/.test(b.journal.sourceId) ||
    !/^(0|[1-9][0-9]*)$/.test(b.journal.head) ||
    !Number.isFinite(Date.parse(b.capturedAt)) ||
    JSON.stringify(Object.keys(b.tables).sort()) !==
      JSON.stringify([...tables].sort()) ||
    tables.some((t) => !Array.isArray(b.tables[t]))
  )
    throw new Error("Invalid backup inventory");
  if (
    Object.keys(b.objects).some(
      (k) => !/^[a-f0-9-]{36}\/(image|thumb)\.webp$/.test(k),
    )
  )
    throw new Error("Invalid backup object");
  return b;
}
async function journalWatermark(c: PoolClient) {
  const state = (
    await c.query(
      "select source_id,head::text from recovery_state where singleton",
    )
  ).rows[0];
  if (!state) throw new Error("Recovery state missing");
  return { sourceId: String(state.source_id), head: String(state.head) };
}
export async function captureDecisions(
  pool: Pool,
  input: unknown,
): Promise<Decisions> {
  const b = backupInput(input),
    sourceDatabase = await local(pool);
  if (b.sourceDatabase !== sourceDatabase)
    throw new Error("Decision source mismatch");
  return locked(pool, async (c) => {
    if ((await journalWatermark(c)).sourceId !== b.journal.sourceId)
      throw new Error("Decision source instance mismatch");
    const users = new Set(
      (await c.query('select id from "user"')).rows.map((r) => r.id),
    );
    const policies = (
      await c.query("select user_id,status,admitted,role from user_policy")
    ).rows as Row[];
    const encounters = (
      await c.query(
        "select id,hidden,visibility,deleted_at,location_size,location_x,location_y,location_context from encounter",
      )
    ).rows as Row[];
    const accounts = (
      await c.query(
        "select id,user_id,provider_id,account_id,password from account",
      )
    ).rows as Row[];
    const factors = (
      await c.query("select id,user_id,secret,backup_codes from two_factor")
    ).rows as Row[];
    const revokedCredentials = b.tables.user
      .filter(
        (u) =>
          credentialFingerprint(b.tables.account, b.tables.two_factor, u.id) !==
          credentialFingerprint(accounts, factors, u.id),
      )
      .map((u) => String(u.id));
    const reports = (await c.query("select id,closed_at from report")).rows;
    const friends = new Set(
      (await c.query("select id from friendship")).rows.map((r) => r.id),
    );
    const live = new Set(
      encounters.filter((r) => !r.deleted_at).map((r) => r.id),
    );
    return {
      version: 1,
      kind: "local-synthetic-decisions",
      backupId: b.id,
      sourceDatabase,
      capturedAt: new Date().toISOString(),
      removedUsers: b.tables.user
        .filter(
          (r) =>
            !users.has(r.id) ||
            policies.some((p) => p.user_id === r.id && p.status === "deleting"),
        )
        .map((r) => String(r.id)),
      removedEncounters: b.tables.encounter
        .filter((r) => !live.has(r.id))
        .map((r) => String(r.id)),
      removedFriendships: b.tables.friendship
        .filter((r) => !friends.has(r.id))
        .map((r) => String(r.id)),
      revokedCredentials,
      removedReports: b.tables.report
        .filter((r) => !reports.some((p) => p.id === r.id))
        .map((r) => String(r.id)),
      closedReports: reports
        .filter(
          (r) =>
            r.closed_at &&
            b.tables.report.some((p) => p.id === r.id && !p.closed_at),
        )
        .map((r) => ({
          id: String(r.id),
          closed_at: new Date(r.closed_at).toISOString(),
        })),
      policies: policies.filter((p) =>
        b.tables.user.some((u) => u.id === p.user_id),
      ),
      encounters: encounters
        .filter((e) => b.tables.encounter.some((r) => r.id === e.id))
        .map((e) => ({ ...e, location_context: null })),
    };
  });
}
export async function restoreBackup(
  pool: Pool,
  storage: RecoveryStorage,
  input: unknown,
  decisions: Decisions,
) {
  const b = backupInput(input),
    target = await local(pool);
  const date = Date.parse(decisions?.capturedAt),
    age = Date.now() - Date.parse(b.capturedAt);
  if (
    !decisions ||
    decisions.version !== 1 ||
    decisions.kind !== "local-synthetic-decisions" ||
    decisions.backupId !== b.id ||
    decisions.sourceDatabase !== b.sourceDatabase ||
    target === b.sourceDatabase ||
    !Number.isFinite(date) ||
    date < Date.parse(b.capturedAt) ||
    date > Date.now() + 1000 ||
    Date.now() - date > 300000 ||
    age < -1000 ||
    age > 30 * day
  )
    throw new Error("Fresh independent decisions and retained backup required");
  if (!(storage instanceof RecoveryStorage))
    throw new Error("Dedicated local recovery storage required");
  const copy = structuredClone(b);
  for (const table of ["account", "two_factor"])
    copy.tables[table] = copy.tables[table].filter(
      (r) => !decisions.revokedCredentials.includes(String(r.user_id)),
    );
  for (const row of copy.tables.user_policy)
    if (decisions.revokedCredentials.includes(String(row.user_id))) {
      row.recovery_pending = true;
      row.recovery_enrolled = false;
    }
  for (const row of copy.tables.user)
    if (decisions.revokedCredentials.includes(String(row.id)))
      row.two_factor_enabled = false;
  // Start with all admissions closed. Reopening is an explicit later operation.
  for (const row of copy.tables.admission) row.active = false;
  for (const row of copy.tables.user_policy) row.admitted = false;
  for (const table of transient) copy.tables[table] = [];
  for (const row of copy.tables.account)
    for (const name of ["access_token", "refresh_token", "id_token"])
      row[name] = null;
  const removedUsers = new Set(decisions.removedUsers),
    removedEncounters = new Set(decisions.removedEncounters);
  const removeMedia = new Set(
    copy.tables.media
      .filter((r) => removedUsers.has(String(r.owner_id)))
      .map((r) => r.id),
  );
  for (const row of copy.tables.encounter)
    if (removedEncounters.has(String(row.id)) || row.deleted_at)
      removeMedia.add(row.media_id);
  copy.tables.encounter = copy.tables.encounter.filter(
    (r) => !removeMedia.has(r.media_id),
  );
  copy.tables.media = copy.tables.media.filter((r) => !removeMedia.has(r.id));
  const deletedEmails = new Set(
    copy.tables.user
      .filter((r) => removedUsers.has(String(r.id)))
      .map((r) => r.email),
  );
  for (const table of tables)
    copy.tables[table] = copy.tables[table].filter(
      (r) =>
        !removedUsers.has(
          String(r.user_id ?? r.owner_id ?? (table === "user" ? r.id : "")),
        ) &&
        !(
          table === "friendship" &&
          (removedUsers.has(String(r.low_id)) ||
            removedUsers.has(String(r.high_id)) ||
            decisions.removedFriendships.includes(String(r.id)))
        ) &&
        !(table === "mail_attempt" && deletedEmails.has(r.recipient)) &&
        !(table === "admission" && deletedEmails.has(r.email)) &&
        !(
          table === "report" &&
          (decisions.removedReports.includes(String(r.id)) ||
            removedUsers.has(String(r.reporter_id)) ||
            removedEncounters.has(String(r.encounter_id)))
        ),
    );
  for (const row of copy.tables.report) {
    const closed = decisions.closedReports.find((r) => r.id === row.id);
    if (closed) {
      row.closed_at = closed.closed_at;
      // The later free-text outcome is deliberately absent from decision traces.
      row.outcome = null;
    }
  }
  for (const row of copy.tables.user_policy) {
    const current = decisions.policies.find((p) => p.user_id === row.user_id);
    if (!current) throw new Error("Incomplete decision policies");
    if (current.status !== "active") row.status = current.status;
    if (current.role !== "admin") row.role = "user";
  }
  for (const row of copy.tables.encounter) {
    const current = decisions.encounters.find((e) => e.id === row.id);
    if (!current) throw new Error("Incomplete decision encounters");
    if (current.hidden) row.hidden = true;
    if (current.visibility === "private") row.visibility = "private";
    for (const name of [
      "location_size",
      "location_x",
      "location_y",
      "location_context",
    ])
      row[name] = current[name];
  }
  const keys = copy.tables.media
    .filter((r) => r.state === "ready")
    .flatMap((r) => [r.id + "/image.webp", r.id + "/thumb.webp"]);
  if (keys.some((k) => typeof copy.objects[k] !== "string"))
    throw new Error("Missing retained photo");
  // The caller supplies a NEW isolated object namespace. On failure, no ready
  // database is committed; cleanup only concerns keys written by this attempt.
  const written: string[] = [];
  try {
    await locked(pool, async (c) => {
      await storage.assertEmpty();
      if ((await signature(c)) !== b.schema)
        throw new Error("Recovery schema mismatch");
      if (
        (await journalWatermark(c)).head !== "0" ||
        (await c.query("select count(*)::int n from recovery_decision")).rows[0]
          .n
      )
        throw new Error("Empty target journal required");
      for (const table of tables)
        if (
          (await c.query(`select exists(select 1 from "${table}") occupied`))
            .rows[0].occupied
        )
          throw new Error("Empty recovery database required");
      for (const table of tables) {
        if (copy.tables[table].length)
          await c.query(
            `insert into "${table}" select * from json_populate_recordset(null::"${table}",$1::json)`,
            [JSON.stringify(copy.tables[table])],
          );
      }
      for (const key of keys) {
        written.push(key);
        await storage.put(key, Buffer.from(copy.objects[key], "base64"));
        if (
          !(await storage.get(key)).equals(
            Buffer.from(copy.objects[key], "base64"),
          )
        )
          throw new Error("Recovered object mismatch");
      }
    });
  } catch (error) {
    if (written.length) await storage.remove(written);
    throw error;
  }
  return {
    users: copy.tables.user.length,
    encounters: copy.tables.encounter.length,
    objects: keys.length,
    admissionsClosed: true as const,
  };
}
