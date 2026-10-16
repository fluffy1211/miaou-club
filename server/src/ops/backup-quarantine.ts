import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Pool, PoolClient } from "pg";
import { LocalStorage } from "../encounters/storage.js";
import type { BundleManifest } from "./backup-bundle.js";
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
export type JournalBundle = {
  version: 1;
  kind: "miaou-remote-decision-journal";
  backupId: string;
  sourceId: string;
  bundleDigest: string;
  start: string;
  end: string;
  copiedAt: string;
  events: Event[];
};
type Anchor = Omit<JournalBundle, "events" | "kind"> & {
  kind: "miaou-remote-journal-anchor";
  digest: string;
};
export type JournalOptions = {
  manifest: BundleManifest;
  journalFile: string;
  anchorsRoot: string;
  keyFile: string;
};
const hex = /^[a-f0-9]{64}$/,
  uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const sequence = (s: unknown): s is string =>
  typeof s === "string" && /^(0|[1-9][0-9]*)$/.test(s);
const digest = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
const numberDate = (s: unknown) =>
  typeof s === "string" ? Date.parse(s) : NaN;
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
function ensure(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid quarantine input");
}
async function privateDirectory(path: string) {
  ensure(
    isAbsolute(path) &&
      resolve(path) === path &&
      (await realpath(path)) === path,
  );
  const s = await lstat(path);
  ensure(s.isDirectory() && (s.mode & 0o777) === 0o700);
}
async function privateBytes(path: string, max: number) {
  await privateDirectory(dirname(path));
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    ensure(
      s.isFile() &&
        s.nlink === 1 &&
        (s.mode & 0o777) === 0o600 &&
        s.size <= max,
    );
    return await f.readFile();
  } finally {
    await f.close();
  }
}
async function immutable(path: string, bytes: Buffer) {
  await privateDirectory(dirname(path));
  const f = await open(path, "wx", 0o600);
  try {
    await f.writeFile(bytes);
    await f.sync();
  } catch (e) {
    await rm(path, { force: true });
    throw e;
  } finally {
    await f.close();
  }
  const d = await open(dirname(path), "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
function crypt(input: Buffer, key: Buffer, encrypt: boolean) {
  ensure(key.length === 32);
  const aad = Buffer.from("miaou-remote-decision-journal-v1");
  if (encrypt) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(aad);
    const bytes = Buffer.concat([c.update(input), c.final()]);
    return Buffer.concat([Buffer.from("MRJ1"), iv, c.getAuthTag(), bytes]);
  }
  ensure(input.length >= 32 && input.subarray(0, 4).toString() === "MRJ1");
  const c = createDecipheriv("aes-256-gcm", key, input.subarray(4, 16));
  c.setAAD(aad);
  c.setAuthTag(input.subarray(16, 32));
  return Buffer.concat([c.update(input.subarray(32)), c.final()]);
}
function validateManifest(m: BundleManifest) {
  ensure(
    m?.version === 1 &&
      m.kind === "miaou-remote-backup-bundle" &&
      uuid.test(m.id) &&
      typeof m.source === "string" &&
      /^[a-z][a-z0-9_-]{0,63}$/.test(m.source),
  );
  const age = Date.now() - numberDate(m.capturedAt);
  ensure(age >= -1000 && age <= 30 * 86400000 && m.postgresMajor === 17);
  ensure(
    m.schema &&
      hex.test(m.schema.signature) &&
      Array.isArray(m.schema.tables) &&
      m.schema.tables.length === 25 &&
      new Set(m.schema.tables).size === 25 &&
      m.schema.tables.every(
        (t) => typeof t === "string" && /^[a-z_]+$/.test(t),
      ),
  );
  ensure(
    Array.isArray(m.schema.migrations) &&
      m.schema.migrations.length > 0 &&
      m.schema.migrations.every(
        (r) => hex.test(r.hash) && sequence(r.createdAt),
      ),
  );
  ensure(
    m.journal &&
      uuid.test(m.journal.sourceId) &&
      sequence(m.journal.head) &&
      sequence(m.journal.floor) &&
      BigInt(m.journal.floor) <= BigInt(m.journal.head),
  );
  ensure(
    m.dump?.path === "database.dump" &&
      Array.isArray(m.photos) &&
      m.photos.length <= 100000,
  );
  const paths = new Set<string>();
  for (const f of [m.dump, ...m.photos]) {
    ensure(
      f &&
        Number.isSafeInteger(f.bytes) &&
        f.bytes > 0 &&
        f.bytes <= (f === m.dump ? 1024 ** 3 : 30_000_000) &&
        hex.test(f.sha256) &&
        typeof f.path === "string" &&
        !paths.has(f.path),
    );
    paths.add(f.path);
  }
  for (const f of m.photos)
    ensure(
      f.key === f.path &&
        /^[a-f0-9-]{36}\/(image|thumb)\.webp$/.test(f.key) &&
        uuid.test(f.key.split("/")[0]),
    );
}
function linked(c: Omit<JournalBundle, "events" | "kind">, m: BundleManifest) {
  validateManifest(m);
  ensure(
    c?.version === 1 &&
      c.backupId === m.id &&
      c.sourceId === m.journal.sourceId &&
      c.bundleDigest === digest(JSON.stringify(m)) &&
      c.start === m.journal.head &&
      sequence(c.start) &&
      sequence(c.end) &&
      BigInt(c.end) >= BigInt(c.start),
  );
  const stamp = numberDate(c.copiedAt);
  ensure(
    stamp >= numberDate(m.capturedAt) &&
      stamp <= Date.now() + 1000 &&
      Date.now() - stamp <= 30 * 86400000,
  );
}
function validateJournal(c: JournalBundle, m: BundleManifest) {
  linked(c, m);
  ensure(
    c.kind === "miaou-remote-decision-journal" &&
      Array.isArray(c.events) &&
      c.events.length <= 1_000_000,
  );
  let next = BigInt(c.start);
  for (const e of c.events) {
    ensure(
      e &&
        Object.keys(e).sort().join() === "code,createdAt,seq,subject" &&
        sequence(e.seq) &&
        BigInt(e.seq) === ++next &&
        codes.includes(e.code) &&
        typeof e.subject === "string" &&
        e.subject.length > 0 &&
        e.subject.length <= 256 &&
        numberDate(e.createdAt) <= numberDate(c.copiedAt),
    );
  }
  ensure(next === BigInt(c.end));
  return c;
}
function separate(options: JournalOptions) {
  const roots = [
    dirname(options.journalFile),
    options.anchorsRoot,
    dirname(options.keyFile),
  ].map((p) => resolve(p));
  for (let a = 0; a < roots.length; a++)
    for (let b = a + 1; b < roots.length; b++)
      ensure(
        roots[a] !== roots[b] &&
          !roots[a].startsWith(roots[b] + sep) &&
          !roots[b].startsWith(roots[a] + sep),
      );
}
async function latest(
  options: JournalOptions,
  key: Buffer,
): Promise<Anchor | undefined> {
  await privateDirectory(options.anchorsRoot);
  let latest: Anchor | undefined;
  for (const name of await readdir(options.anchorsRoot)) {
    if (!name.startsWith(options.manifest.id + ".")) continue;
    const a = JSON.parse(
      crypt(
        await privateBytes(join(options.anchorsRoot, name), 65536),
        key,
        false,
      ).toString(),
    ) as Anchor;
    linked(a, options.manifest);
    ensure(
      a.kind === "miaou-remote-journal-anchor" &&
        hex.test(a.digest) &&
        name === `${a.backupId}.${a.end}.anchor`,
    );
    if (!latest || BigInt(a.end) > BigInt(latest.end)) latest = a;
  }
  return latest;
}
export async function readJournalBundle(
  options: JournalOptions,
): Promise<JournalBundle> {
  separate(options);
  const key = await privateBytes(options.keyFile, 32),
    bytes = await privateBytes(options.journalFile, 64 * 1024 ** 2),
    a = await latest(options, key);
  ensure(a && a.digest === digest(bytes));
  const c = validateJournal(
    JSON.parse(crypt(bytes, key, false).toString()),
    options.manifest,
  );
  ensure(c.end === a.end && c.copiedAt === a.copiedAt);
  return c;
}
export async function captureJournalBundle(
  options: JournalOptions & { pool: Pool },
) {
  separate(options);
  validateManifest(options.manifest);
  const key = await privateBytes(options.keyFile, 32);
  ensure(key.length === 32);
  const c = await options.pool.connect();
  let journalWritten = false,
    anchorWritten = false,
    anchorPath = "";
  try {
    await c.query("begin isolation level repeatable read");
    await c.query("set local lock_timeout='3s'");
    await c.query("set local statement_timeout='30s'");
    await c.query(
      "lock table recovery_state,recovery_decision in exclusive mode",
    );
    const state = (
      await c.query(
        "select source_id,head::text,floor::text from recovery_state where singleton",
      )
    ).rows[0];
    ensure(
      state &&
        state.source_id === options.manifest.journal.sourceId &&
        sequence(state.head) &&
        sequence(state.floor) &&
        BigInt(state.floor) <= BigInt(options.manifest.journal.head),
    );
    const rows = (
      await c.query(
        'select seq::text,code,subject,created_at as "createdAt" from recovery_decision where seq>$1 order by recovery_decision.seq',
        [options.manifest.journal.head],
      )
    ).rows;
    const journal = validateJournal(
      {
        version: 1,
        kind: "miaou-remote-decision-journal",
        backupId: options.manifest.id,
        sourceId: state.source_id,
        bundleDigest: digest(JSON.stringify(options.manifest)),
        start: options.manifest.journal.head,
        end: state.head,
        copiedAt: (
          await c.query("select clock_timestamp() stamp")
        ).rows[0].stamp.toISOString(),
        events: rows.map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
        })) as Event[],
      },
      options.manifest,
    );
    const previous = await latest(options, key);
    ensure(!previous || BigInt(previous.end) < BigInt(journal.end));
    const bytes = crypt(Buffer.from(JSON.stringify(journal)), key, true);
    await immutable(options.journalFile, bytes);
    journalWritten = true;
    const { events: _events, kind: _kind, ...metadata } = journal;
    anchorPath = join(
      options.anchorsRoot,
      `${journal.backupId}.${journal.end}.anchor`,
    );
    await immutable(
      anchorPath,
      crypt(
        Buffer.from(
          JSON.stringify({
            ...metadata,
            kind: "miaou-remote-journal-anchor",
            digest: digest(bytes),
          }),
        ),
        key,
        true,
      ),
    );
    anchorWritten = true;
    await c.query("commit");
    return {
      copiedAt: journal.copiedAt,
      copiedThrough: journal.end,
      uncopiedAfterCut: "unknown" as const,
    };
  } catch {
    await c.query("rollback").catch(() => {});
    if (journalWritten) await rm(options.journalFile, { force: true });
    if (anchorWritten) await rm(anchorPath, { force: true });
    throw new Error("Journal capture failed");
  } finally {
    c.release();
  }
}
async function verifyBundle(root: string) {
  await privateDirectory(root);
  const manifest = JSON.parse(
    (await privateBytes(join(root, "manifest.json"), 1024 ** 2)).toString(),
  ) as BundleManifest;
  validateManifest(manifest);
  const expected = new Set(["manifest.json"]);
  for (const f of [manifest.dump, ...manifest.photos]) {
    expected.add(f.path);
    const path = join(root, f.path);
    await privateDirectory(dirname(path));
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      ensure(
        stat.isFile() &&
          stat.nlink === 1 &&
          (stat.mode & 0o777) === 0o600 &&
          stat.size === f.bytes,
      );
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false }))
        hash.update(chunk);
      ensure(hash.digest("hex") === f.sha256);
    } finally {
      await handle.close();
    }
  }
  async function walk(path: string, prefix = "") {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const key = prefix + e.name;
      ensure(!e.isSymbolicLink());
      if (e.isDirectory()) {
        ensure([...expected].some((p) => p.startsWith(key + "/")));
        await privateDirectory(join(path, e.name));
        await walk(join(path, e.name), key + "/");
      } else ensure(e.isFile() && expected.has(key));
    }
  }
  await walk(root);
  return manifest;
}
async function replay(c: PoolClient, events: Event[]) {
  for (const event of events) {
    const id = [event.subject];
    switch (event.code) {
      case "user_remove":
        await c.query(
          'delete from admission where email in(select email from "user" where id=$1)',
          id,
        );
        await c.query(
          'delete from mail_attempt where recipient in(select email from "user" where id=$1)',
          id,
        );
        await c.query(
          "delete from report where reporter_id=$1 or encounter_id in(select id from encounter where owner_id=$1)",
          id,
        );
        for (const table of [
          "encounter",
          "media",
          "upload_attempt",
          "account_deletion",
        ])
          await c.query(`delete from ${table} where owner_id=$1`, id);
        await c.query('delete from "user" where id=$1', id);
        break;
      case "user_suspend":
        await c.query(
          "update user_policy set status='suspended' where user_id=$1 and status not in('withdrawn','deleting')",
          id,
        );
        break;
      case "user_withdraw":
        await c.query(
          "update user_policy set status='withdrawn' where user_id=$1 and status<>'deleting'",
          id,
        );
        break;
      case "user_demote":
        await c.query(
          "update user_policy set role='user' where user_id=$1",
          id,
        );
        break;
      case "credentials_revoke":
        await c.query("delete from account where user_id=$1", id);
        await c.query("delete from two_factor where user_id=$1", id);
        await c.query(
          "update user_policy set recovery_pending=true,recovery_enrolled=false where user_id=$1",
          id,
        );
        await c.query(
          'update "user" set two_factor_enabled=false where id=$1',
          id,
        );
        break;
      case "encounter_remove":
        await c.query("delete from report where encounter_id=$1", id);
        for (const row of (
          await c.query(
            "delete from encounter where id=$1 returning media_id",
            id,
          )
        ).rows)
          await c.query("delete from media where id=$1", [row.media_id]);
        break;
      case "encounter_hide":
        await c.query("update encounter set hidden=true where id=$1", id);
        break;
      case "encounter_private":
        await c.query(
          "update encounter set visibility='private' where id=$1",
          id,
        );
        break;
      case "location_remove":
        await c.query(
          "update encounter set location_size=null,location_x=null,location_y=null,location_context=null where id=$1",
          id,
        );
        break;
      case "friendship_remove":
        await c.query("delete from friendship where id::text=$1", id);
        break;
      case "report_remove":
        await c.query("delete from report where id=$1", id);
        break;
      case "report_close":
        await c.query(
          "update report set closed_at=$2,outcome=null where id=$1 and closed_at is null",
          [event.subject, event.createdAt],
        );
        break;
    }
  }
}
export type RestoreQuarantineOptions = Omit<JournalOptions, "manifest"> & {
  pool: Pool;
  controlPool: Pool;
  bundleRoot: string;
  mediaRoot: string;
  targetIsolated: true;
  deadlineMs?: number;
  restore: (dumpPath: string, signal: AbortSignal) => Promise<void>;
};
/** Local quarantine only. Operator isolates the DB during pg_restore; this
 * module permanently disables new DB connections before sanitising. The held
 * administrative connection is never handed to an application. No reopening API.
 * restore must honour abort, terminate and reap its child before settling. */
export async function restoreQuarantine(options: RestoreQuarantineOptions) {
  ensure(options.targetIsolated === true);
  const url = new URL(options.pool.options.connectionString ?? "invalid:");
  ensure(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      /^\/[a-z0-9_]+_quarantine$/.test(url.pathname) &&
      !url.search &&
      !url.hash,
  );
  const controlUrl = new URL(
    options.controlPool.options.connectionString ?? "invalid:",
  );
  ensure(
    ["postgres:", "postgresql:"].includes(controlUrl.protocol) &&
      controlUrl.hostname === url.hostname &&
      controlUrl.port === url.port &&
      controlUrl.username === url.username &&
      controlUrl.pathname !== url.pathname &&
      !controlUrl.search &&
      !controlUrl.hash,
  );
  const timeout = options.deadlineMs ?? 600000;
  ensure(Number.isInteger(timeout) && timeout >= 1 && timeout <= 600000);
  const manifest = await verifyBundle(options.bundleRoot),
    journal = await readJournalBundle({ ...options, manifest });
  const root = options.mediaRoot;
  ensure(isAbsolute(root) && resolve(root) === root);
  await privateDirectory(dirname(root));
  const c = await options.pool.connect();
  let created: Awaited<ReturnType<typeof lstat>> | undefined,
    guarded = false,
    inTransaction = false,
    success = false;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeout);
  timer.unref();
  const check = () => ensure(!controller.signal.aborted);
  try {
    const info = (
      await c.query(
        "select current_database() name,current_user username,(select datdba=(select oid from pg_roles where rolname=current_user) from pg_database where datname=current_database()) owned",
      )
    ).rows[0];
    ensure(url.pathname === "/" + info.name && info.owned);
    const control = (
      await options.controlPool.query(
        "select current_database() name,current_user username,(select rolsuper from pg_roles where rolname=current_user) superuser,(select system_identifier::text from pg_control_system()) cluster",
      )
    ).rows[0];
    ensure(
      control.name === controlUrl.pathname.slice(1) &&
        control.username === info.username &&
        control.superuser &&
        control.cluster ===
          (
            await c.query(
              "select system_identifier::text cluster from pg_control_system()",
            )
          ).rows[0].cluster,
    );
    ensure(
      !(
        await c.query(
          "select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()) occupied",
        )
      ).rows[0].occupied,
    );
    ensure(
      !(
        await c.query(
          "select exists(select 1 from pg_class where relnamespace in(select oid from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema')) occupied",
        )
      ).rows[0].occupied,
    );
    ensure(
      !(
        await c.query(
          "select exists(select 1 from pg_proc where pronamespace in(select oid from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema')) occupied",
        )
      ).rows[0].occupied,
    );
    ensure(
      !(
        await c.query(
          "select exists(select 1 from pg_database d, lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a where d.datname=current_database() and a.privilege_type='CONNECT' and a.grantee not in(0,d.datdba)) occupied",
        )
      ).rows[0].occupied,
    );
    await mkdir(root, { mode: 0o700 });
    created = await lstat(root);
    await c.query(`revoke connect on database ${quote(info.name)} from public`);
    guarded = true;
    check();
    try {
      await options.restore(
        join(options.bundleRoot, "database.dump"),
        controller.signal,
      );
    } finally {
      await options.controlPool.query(
        `alter database ${quote(info.name)} allow_connections false`,
      );
    }
    check();
    ensure(
      !(
        await c.query(
          "select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()) occupied",
        )
      ).rows[0].occupied,
    );
    await c.query("begin isolation level repeatable read");
    inTransaction = true;
    await c.query("set local statement_timeout='30s'");
    await c.query("set local lock_timeout='3s'");
    const state = (
      await c.query(
        "select source_id,head::text,floor::text from recovery_state where singleton",
      )
    ).rows[0];
    ensure(
      state?.source_id === manifest.journal.sourceId &&
        state.head === manifest.journal.head &&
        state.floor === manifest.journal.floor,
    );
    const migrations = (
      await c.query(
        "select hash,created_at::text from drizzle.__drizzle_migrations order by id",
      )
    ).rows;
    ensure(
      JSON.stringify(
        migrations.map((r) => ({ hash: r.hash, createdAt: r.created_at })),
      ) === JSON.stringify(manifest.schema.migrations),
    );
    for (const table of [
      "session_security",
      "session",
      "verification",
      "data_export",
      "report_consultation",
    ])
      await c.query(`delete from ${table}`);
    await replay(c, journal.events);
    await c.query(
      "delete from report where encounter_id in(select id from encounter where deleted_at is not null)",
    );
    await c.query("delete from encounter where deleted_at is not null");
    await c.query(
      "delete from media where not exists(select 1 from encounter where encounter.media_id=media.id)",
    );
    await c.query("update media set original_present=false");
    await c.query("update admission set active=false");
    await c.query("update user_policy set admitted=false");
    await c.query(
      "update account set access_token=null,refresh_token=null,id_token=null",
    );
    const ready = (
      await c.query(
        "select distinct m.id from media m join encounter e on e.media_id=m.id where m.state='ready' and e.deleted_at is null order by m.id",
      )
    ).rows;
    const files = new Map(manifest.photos.map((f) => [f.key, f]));
    const storage = new LocalStorage(root);
    let objects = 0;
    for (const row of ready)
      for (const suffix of ["image.webp", "thumb.webp"]) {
        check();
        const key = `${row.id}/${suffix}`,
          file = files.get(key);
        ensure(file);
        const bytes = await privateBytes(
          join(options.bundleRoot, key),
          30_000_000,
        );
        ensure(bytes.length === file.bytes && digest(bytes) === file.sha256);
        check();
        await storage.put(key, bytes);
        objects++;
      }
    check();
    await c.query("commit");
    inTransaction = false;
    success = true;
    return {
      quarantined: true as const,
      admissionsClosed: true as const,
      databaseConnectionsDisabled: true as const,
      objects,
      copiedThrough: journal.end,
      copiedAt: journal.copiedAt,
      uncopiedAfterCut: "unknown" as const,
    };
  } catch {
    throw new Error("Quarantine restore failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (inTransaction) await c.query("rollback").catch(() => {});
    if (guarded)
      await options.controlPool
        .query(
          `alter database ${quote(url.pathname.slice(1))} allow_connections false`,
        )
        .catch(() => {});
    c.release();
    if (!success && created) {
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
