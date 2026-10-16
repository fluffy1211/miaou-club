import { Buffer } from "node:buffer";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  ResticRepository,
  verifyBundle,
  command,
  cycle,
  notifyFailure,
} from "../scripts/remote-backup-repository.mjs";
const binary = process.env.MIAOU_RESTIC_BINARY;
assert.ok(
  binary,
  "MIAOU_RESTIC_BINARY required; tests must exercise a real restic binary",
);
async function fixture(t) {
  const root = await mkdtemp(
    join(realpathSync(tmpdir()), "miaou-restic-test-"),
  );
  await mkdir(join(root, "stage"), { mode: 0o700 });
  await writeFile(join(root, "password"), randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function bundle(root, name = "bundle") {
  const stage = join(root, name);
  await mkdir(stage, { mode: 0o700 });
  const bytes = Buffer.from("synthetic database dump");
  await writeFile(join(stage, "database.dump"), bytes, { mode: 0o600 });
  const m = {
    version: 1,
    kind: "miaou-remote-backup-bundle",
    id: randomUUID(),
    source: "miaou-test",
    capturedAt: new Date().toISOString(),
    dump: {
      path: "database.dump",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    photos: [],
  };
  await writeFile(join(stage, "manifest.json"), JSON.stringify(m), {
    mode: 0o600,
  });
  return stage;
}
function repo(root, options = {}) {
  return new ResticRepository({
    binary,
    repository: join(root, "repo"),
    passwordFile: join(root, "password"),
    source: "miaou-test",
    ...options,
  });
}
test("real restic encrypts, recovers a verified bundle after source loss, and refuses occupied target", async (t) => {
  const r = await fixture(t),
    repository = repo(r);
  await repository.initialize();
  const src = await bundle(r);
  const receipt = await repository.backup(src);
  await rm(src, { recursive: true });
  const target = join(r, "recovered");
  const result = await repository.recover(receipt, target);
  assert.equal(result.id, receipt.bundleId);
  assert.equal(
    await readFile(join(target, "database.dump"), "utf8"),
    "synthetic database dump",
  );
  await assert.rejects(repository.recover(receipt, target));
  assert.equal((await verifyBundle(target, "miaou-test")).id, receipt.bundleId);
  assert.deepEqual(await repository.rotate(), {
    expiredSnapshots: 0,
    physicalProviderVersionPurgeVerified: false,
  });
  await writeFile(join(r, "wrong-password"), randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
  await assert.rejects(
    repo(r, { passwordFile: join(r, "wrong-password") }).recover(
      receipt,
      join(r, "wrong-target"),
    ),
    /backup child failed/,
  );
  await assert.rejects(lstat(join(r, "wrong-target")));
});
test("bundle corruption, symlinks, extra files and wrong source stop archival", async (t) => {
  const r = await fixture(t),
    src = await bundle(r);
  await assert.rejects(verifyBundle(src, "other-source"));
  await writeFile(join(src, "secret-token"), "must-not-back-up", {
    mode: 0o600,
  });
  await assert.rejects(verifyBundle(src, "miaou-test"));
  await rm(join(src, "secret-token"));
  await writeFile(join(src, "database.dump"), "damaged", { mode: 0o600 });
  await assert.rejects(verifyBundle(src, "miaou-test"));
  await rm(join(src, "database.dump"));
  await symlink(join(r, "password"), join(src, "database.dump"));
  await assert.rejects(verifyBundle(src, "miaou-test"));
});
test("failed restic cycle writes failure, delivers only safe alert metadata and removes plaintext staging", async (t) => {
  const r = await fixture(t);
  let received;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    received = JSON.parse(Buffer.concat(chunks));
    res.writeHead(204);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let stage;
  await assert.rejects(
    cycle({
      capture: async () => (stage = await bundle(r)),
      repository: {
        backup: async () => {
          throw Error("synthetic-secret-leak");
        },
      },
      stateFile: join(r, "state.json"),
      alertUrl: `http://127.0.0.1:${server.address().port}/private-webhook`,
      alertLocal: true,
    }),
    /backup cycle failed/,
  );
  assert.deepEqual(received, {
    component: "miaou-backup",
    code: "backup_failed",
  });
  const state = await readFile(join(r, "state.json"), "utf8");
  assert.ok(!state.includes("secret"));
  assert.equal(JSON.parse(state).alertDelivered, true);
  await assert.rejects(lstat(stage));
});
test("successful restic cycle persists technical receipt and removes plaintext staging", async (t) => {
  const r = await fixture(t),
    repository = repo(r);
  await repository.initialize();
  let stage;
  const receipt = await cycle({
    capture: async () => (stage = await bundle(r)),
    repository,
    stateFile: join(r, "state.json"),
  });
  const state = JSON.parse(await readFile(join(r, "state.json"), "utf8"));
  assert.equal(state.code, "backup_ok");
  assert.equal(state.receipt.snapshotId, receipt.snapshotId);
  assert.equal((await lstat(join(r, "state.json"))).mode & 0o777, 0o600);
  await assert.rejects(lstat(stage));
});
test("child diagnostics never leak secret output; stalled children are killed and waited for", async () => {
  await assert.rejects(
    command(process.execPath, [
      "-e",
      'console.error("secret");process.exit(3)',
    ]),
    (err) => err.message === "backup child failed",
  );
  const start = Date.now();
  await assert.rejects(
    command(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeoutMs: 50,
    }),
    /backup child failed/,
  );
  assert.ok(Date.now() - start < 2000);
});
test("remote requires dedicated private credentials; alert rejects redirects and unsafe schemes", async (t) => {
  const r = await fixture(t);
  assert.throws(() => repo(r, { repository: "s3:http://example.test/bucket" }));
  const remote = repo(r, {
    repository:
      "s3:https://s3.eu-central-003.backblazeb2.com/miaou-backups/repository",
  });
  await assert.rejects(
    remote.initialize(),
    /remote repository credentials required/,
  );
  await assert.rejects(notifyFailure("http://example.test/", "backup_failed"));
});
test("failed cycles retain last success time; overdue status is explicit", async (t) => {
  const { inspectStatus } =
    await import("../scripts/remote-backup-repository.mjs");
  const r = await fixture(t),
    file = join(r, "state.json"),
    at = new Date().toISOString();
  await writeFile(
    file,
    JSON.stringify({ version: 1, code: "backup_ok", finishedAt: at }),
    { mode: 0o600 },
  );
  await assert.rejects(
    cycle({
      capture: async () => {
        throw Error("synthetic");
      },
      repository: {},
      stateFile: file,
    }),
  );
  const s = JSON.parse(await readFile(file));
  assert.equal(s.lastSuccessAt, at);
  assert.equal((await inspectStatus(file)).code, "backup_failed");
  assert.equal(
    (await inspectStatus(file, Date.now() + 25 * 3600000)).code,
    "backup_overdue",
  );
});
test("rotation refuses an empty or stale repository", async (t) => {
  const r = await fixture(t),
    repository = repo(r);
  await repository.initialize();
  await assert.rejects(repository.rotate(), /fresh backup required/);
});
test("rotation really prunes expired owned snapshots, preserves current and foreign snapshots, and refuses stale-only repositories", async (t) => {
  const r = await fixture(t),
    repository = repo(r);
  await repository.initialize();
  const src = await bundle(r);
  const ago = new Date(Date.now() - 29 * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  async function past(host, tag) {
    const lines = (
      await repository.run([
        "backup",
        "--json",
        "--host",
        host,
        "--tag",
        tag,
        "--time",
        ago,
        src,
      ])
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    return lines.find((x) => x.message_type === "summary").snapshot_id;
  }
  const stale = await past("miaou-test", "miaou-backup:miaou-test");
  await assert.rejects(repository.rotate(), /fresh backup required/);
  const before = JSON.parse(await repository.run(["snapshots", "--json"]));
  assert.ok(before.some((s) => s.id === stale));
  const foreign = await past("other-source", "other-tag");
  const fresh = await repository.backup(src);
  const result = await repository.rotate();
  assert.equal(result.expiredSnapshots, 1);
  const after = JSON.parse(await repository.run(["snapshots", "--json"]));
  assert.ok(!after.some((s) => s.id === stale));
  assert.ok(after.some((s) => s.id === fresh.snapshotId));
  assert.ok(after.some((s) => s.id === foreign));
  await rm(src, { recursive: true });
  await repository.recover(fresh, join(r, "current-restored"));
});
