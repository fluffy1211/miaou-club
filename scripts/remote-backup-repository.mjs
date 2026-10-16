import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  lstat,
  realpath,
  mkdir,
  readFile,
  readdir,
  rm,
  open,
  rename,
} from "node:fs/promises";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const hex = /^[a-f0-9]{64}$/;
const sourcePattern = /^[a-z][a-z0-9-]{1,62}$/;
export async function privateFile(path) {
  assert.equal(await realpath(path), path, "canonical private file required");
  const s = await lstat(path);
  assert.ok(
    s.isFile() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o600,
    "private file required",
  );
  return s;
}
async function privateDirectory(path) {
  assert.ok(isAbsolute(path) && resolve(path) === path);
  assert.equal(await realpath(path), path, "canonical directory required");
  const s = await lstat(path);
  assert.ok(
    s.isDirectory() && (s.mode & 0o777) === 0o700,
    "private directory required",
  );
}
export async function verifyBundle(root, source) {
  assert.match(source, sourcePattern);
  await privateDirectory(root);
  const meta = await privateFile(join(root, "manifest.json"));
  assert.ok(meta.size <= 1048576);
  const m = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  assert.equal(m.version, 1);
  assert.equal(m.kind, "miaou-remote-backup-bundle");
  assert.equal(m.source, source);
  assert.match(m.id, /^[a-f0-9-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(m.capturedAt)));
  assert.ok(Array.isArray(m.photos) && m.photos.length <= 100000);
  const expected = new Set(["manifest.json"]);
  for (const item of [m.dump, ...m.photos]) {
    assert.ok(item && typeof item.path === "string");
    assert.ok(
      item.path === "database.dump" ||
        /^[a-f0-9-]{36}\/(image|thumb)\.webp$/.test(item.path),
    );
    assert.ok(!expected.has(item.path), "duplicate file");
    expected.add(item.path);
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0);
    assert.match(item.sha256, hex);
    const s = await privateFile(join(root, item.path));
    assert.equal(s.size, item.bytes);
    const fd = await open(join(root, item.path), "r");
    const hash = createHash("sha256");
    try {
      for await (const chunk of fd.createReadStream({ autoClose: false }))
        hash.update(chunk);
    } finally {
      await fd.close();
    }
    assert.equal(hash.digest("hex"), item.sha256, "bundle checksum mismatch");
  }
  assert.equal(m.dump.path, "database.dump");
  async function walk(dir, prefix = "") {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const name = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink(), "bundle symlink");
      if (entry.isDirectory()) {
        assert.ok(
          [...expected].some((p) => p.startsWith(name + "/")),
          "extra directory",
        );
        await walk(join(dir, entry.name), name + "/");
      } else
        assert.ok(
          entry.isFile() && expected.has(name),
          "unexpected bundle entry",
        );
    }
  }
  await walk(root);
  return m;
}
// Child diagnostics never enter persisted status or thrown errors.
export function command(
  binary,
  args,
  { env = {}, cwd, timeoutMs = 600000, maxBytes = 2097152 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    let size = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        child.kill("SIGKILL");
      } else output.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      failed = true;
      reject(Error("backup child unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(Error("backup child failed"));
      else resolve(Buffer.concat(output).toString("utf8"));
    });
  });
}
export class ResticRepository {
  constructor({
    binary,
    repository,
    passwordFile,
    credentialsFile,
    source,
    timeoutMs = 600000,
  }) {
    assert.ok(isAbsolute(binary));
    assert.match(source, sourcePattern);
    if (!isAbsolute(repository))
      assert.match(
        repository,
        /^s3:https:\/\/s3\.eu-central-\d{3}\.backblazeb2\.com\/[a-z0-9][a-z0-9-]{5,62}\/[a-z0-9/-]+$/,
      );
    this.options = {
      binary,
      repository,
      passwordFile,
      credentialsFile,
      source,
      timeoutMs,
    };
  }
  async run(args) {
    const o = this.options;
    await privateFile(o.passwordFile);
    assert.ok(
      (await readFile(o.passwordFile)).length >= 32,
      "separate strong repository password required",
    );
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      RESTIC_PASSWORD_FILE: o.passwordFile,
    };
    if (o.credentialsFile) {
      await privateFile(o.credentialsFile);
      const c = JSON.parse(await readFile(o.credentialsFile, "utf8"));
      assert.deepEqual(Object.keys(c).sort(), [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
      ]);
      for (const [k, v] of Object.entries(c)) {
        assert.equal(typeof v, "string");
        assert.ok(v.length > 0);
        env[k] = v;
      }
    } else
      assert.ok(
        isAbsolute(o.repository),
        "remote repository credentials required",
      );
    return command(o.binary, ["--no-cache", "--repo", o.repository, ...args], {
      env,
      timeoutMs: o.timeoutMs,
    });
  }
  async initialize() {
    await this.run(["init", "--repository-version", "2"]);
  }
  async backup(root) {
    const o = this.options,
      m = await verifyBundle(root, o.source);
    const age = Date.now() - Date.parse(m.capturedAt);
    assert.ok(age >= -1000 && age < 600000, "fresh bundle required");
    const out = await this.run([
      "backup",
      "--json",
      "--host",
      o.source,
      "--tag",
      "miaou-backup:" + o.source,
      root,
    ]);
    const summary = out
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x))
      .find((x) => x.message_type === "summary");
    assert.match(summary?.snapshot_id, hex);
    return {
      version: 1,
      source: o.source,
      bundleId: m.id,
      snapshotId: summary.snapshot_id,
      path: root,
      capturedAt: m.capturedAt,
    };
  }
  async recover(receipt, target) {
    assert.equal(receipt.source, this.options.source);
    assert.match(receipt.snapshotId, hex);
    assert.ok(
      isAbsolute(receipt.path) && resolve(receipt.path) === receipt.path,
    );
    await privateDirectory(dirname(target));
    await mkdir(target, { mode: 0o700 });
    const inode = (await lstat(target)).ino;
    try {
      await this.run([
        "restore",
        receipt.snapshotId + ":" + receipt.path,
        "--target",
        target,
        "--verify",
      ]);
      const m = await verifyBundle(target, this.options.source);
      assert.equal(m.id, receipt.bundleId);
      return m;
    } catch (error) {
      if ((await lstat(target)).ino === inode)
        await rm(target, { recursive: true });
      throw error;
    }
  }
  // Must follow a fresh successful backup. Explicit absolute age, never relative to an old newest snapshot.
  async rotate(now = Date.now()) {
    const source = this.options.source;
    const snapshots = JSON.parse(
      await this.run([
        "snapshots",
        "--json",
        "--host",
        source,
        "--tag",
        "miaou-backup:" + source,
      ]),
    );
    assert.ok(
      snapshots.length &&
        snapshots.some(
          (s) =>
            now - Date.parse(s.time) >= -1000 &&
            now - Date.parse(s.time) < 86400000,
        ),
      "fresh backup required before rotation",
    );
    const expired = snapshots.filter(
      (s) => now - Date.parse(s.time) > 28 * 86400000,
    );
    for (const s of expired) {
      assert.equal(s.hostname, source);
      assert.ok(s.tags.includes("miaou-backup:" + source));
      assert.match(s.id, hex);
    }
    if (expired.length)
      await this.run(["forget", "--prune", ...expired.map((s) => s.id)]);
    return {
      expiredSnapshots: expired.length,
      physicalProviderVersionPurgeVerified: false,
    };
  }
}
export async function writeStatus(path, value) {
  await privateDirectory(dirname(path));
  const temp = path + "." + randomUUID() + ".pending";
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  try {
    await rename(temp, path);
    const dir = await open(dirname(path), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}
export async function notifyFailure(url, code, { local = false } = {}) {
  const u = new URL(url);
  assert.ok(!u.username && !u.password);
  assert.ok(
    u.protocol === "https:" ||
      (local && u.protocol === "http:" && u.hostname === "127.0.0.1"),
  );
  assert.ok(
    ["backup_failed", "backup_overdue", "backup_alert_failed"].includes(code),
  );
  // The endpoint may be a secret; it never enters errors or status files.
  try {
    const r = await fetch(u, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ component: "miaou-backup", code }),
      signal: AbortSignal.timeout(10000),
    });
    assert.ok(r.ok);
  } catch {
    throw Error("backup alert failed");
  }
}
export async function inspectStatus(path, now = Date.now()) {
  await privateFile(path);
  const s = JSON.parse(await readFile(path, "utf8"));
  const success = s.code === "backup_ok" ? s.finishedAt : s.lastSuccessAt;
  const age = now - Date.parse(success);
  if (!Number.isFinite(age) || age < 0 || age > 86400000)
    return { code: "backup_overdue" };
  return { code: s.code === "backup_ok" ? "backup_ok" : "backup_failed" };
}
export async function cycle({
  capture,
  repository,
  stateFile,
  alertUrl,
  alertLocal = false,
}) {
  const startedAt = new Date().toISOString();
  let root,
    lastSuccessAt = null;
  try {
    try {
      await privateFile(stateFile);
      const previous = JSON.parse(await readFile(stateFile, "utf8"));
      lastSuccessAt =
        previous.code === "backup_ok"
          ? previous.finishedAt
          : previous.lastSuccessAt;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    root = await capture();
    const receipt = await repository.backup(root);
    const rotation = await repository.rotate();
    // Remove plaintext before committing success. An incomplete cleanup is a failed cycle.
    await rm(root, { recursive: true });
    root = undefined;
    await writeStatus(stateFile, {
      version: 1,
      code: "backup_ok",
      startedAt,
      finishedAt: new Date().toISOString(),
      receipt,
      rotation,
    });
    return receipt;
  } catch {
    let stagingCleaned = true;
    if (root)
      try {
        await rm(root, { recursive: true });
        root = undefined;
      } catch {
        stagingCleaned = false;
      }
    let alertDelivered = false;
    if (alertUrl)
      try {
        await notifyFailure(alertUrl, "backup_failed", { local: alertLocal });
        alertDelivered = true;
      } catch {
        alertDelivered = false;
      }
    await writeStatus(stateFile, {
      version: 1,
      code: "backup_failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      lastSuccessAt,
      stagingCleaned,
      alertDelivered,
    });
    throw Error("backup cycle failed");
  }
}
