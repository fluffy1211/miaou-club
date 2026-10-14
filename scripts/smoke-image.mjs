import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createDatabase,
  closePool,
} from "../dist/backend/infrastructure/db/client.js";
const testURL = new URL(
  process.env.TEST_DATABASE_URL ??
    "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test",
);
if (!testURL.pathname.endsWith("_test"))
  throw new Error("Image smoke test requires a dedicated test DB");
const name = `smoke_${randomUUID().replaceAll("-", "")}_test`;
const container = `miaou-smoke-${randomUUID()}`;
const image = process.env.MIAOU_IMAGE ?? "miaou-lot1:local";
const authSecret = `${randomUUID()}${randomUUID()}`;
const admin = createDatabase(testURL.href);
const target = new URL(testURL);
target.pathname = name;
let database;
try {
  await admin.pool.query(`create database "${name}"`);
  database = createDatabase(target.href);
  const dockerURL = new URL(target);
  if (["localhost", "127.0.0.1"].includes(dockerURL.hostname))
    dockerURL.hostname = "host.docker.internal";
  const run = (args) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const runInput = (args, input, env = {}) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      input,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
  // Exercise the compiled migration entry point of the actual runtime image,
  // before activating the application; no host migrator or SQL rollback.
  run([
    "run",
    "--rm",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `DATABASE_URL=${dockerURL.href}`,
    "--entrypoint",
    "node",
    image,
    "dist/backend/infrastructure/db/migrate.js",
  ]);
  const migrations = await database.pool.query(
    "select count(*)::int n from drizzle.__drizzle_migrations",
  );
  if (!migrations.rows[0].n) throw new Error("Runtime migrations missing");
  run([
    "run",
    "-d",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    "127.0.0.1::4321",
    "-e",
    `DATABASE_URL=${dockerURL.href}`,
    "-e",
    `BETTER_AUTH_SECRET=${authSecret}`,
    "-e",
    "BETTER_AUTH_URL=https://localhost",
    image,
  ]);
  const port = run(["port", container, "4321/tcp"]).trim().split(":").at(-1);
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      if ((await fetch(origin + "/api/health")).status === 200) break;
    } catch {
      /* startup in progress */
    }
    if (Date.now() >= deadline) throw new Error("Image did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const [path, expected] of [
    ["/api/ready", 200],
    ["/api/v1/access", 401],
    ["/api/v1/me/friends", 401],
    ["/api/v1/people?q=synthetic", 401],
    ["/api/v1/me/encounters", 401],
    ["/api/v1/encounters", 401],
    ["/media/00000000-0000-0000-0000-000000000000/image", 401],
    ["/_image?href=synthetic", 401],
    ["/_astro/synthetic.%73vg", 401],
  ]) {
    const response = await fetch(origin + path);
    if (response.status !== expected)
      throw new Error(
        `Image response mismatch for ${path}: ${response.status}`,
      );
    if (response.headers.get("cache-control") !== "no-store")
      throw new Error("Missing no-store");
  }
  const page = await fetch(origin + "/races", { redirect: "manual" });
  if (
    page.status !== 302 ||
    page.headers.get("location") !== "/profil?retour=%2Fraces"
  )
    throw new Error("Catalogue guard failed in image");
  const notice = await fetch(origin + "/acces");
  if (
    notice.status !== 200 ||
    !(await notice.text()).includes(
      "Les inscriptions ne sont pas encore ouvertes.",
    )
  )
    throw new Error("Astro/React notice failed in image");
  console.log(
    "Docker runtime: health, PostgreSQL readiness, page rendering and access refusals passed",
  );

  // Exercise proxy resolution through the real Node adapter. Requests originate
  // inside the container so the trusted peer is its loopback, not Docker's host
  // bridge address. Reuse only this smoke's disposable database.
  run(["rm", "-f", container]);
  run([
    "run",
    "-d",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    "127.0.0.1::4321",
    "-e",
    `DATABASE_URL=${dockerURL.href}`,
    "-e",
    `BETTER_AUTH_SECRET=${authSecret}`,
    "-e",
    "BETTER_AUTH_URL=https://localhost",
    "-e",
    "MIAOU_TRUSTED_PROXY_CIDRS=127.0.0.1/32",
    image,
  ]);
  const proxyProof = String.raw`
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createDatabase } from '/app/dist/backend/infrastructure/db/client.js';
import { AuthLimits } from '/app/dist/backend/accounts/limits.js';
const { db, pool } = createDatabase(process.env.DATABASE_URL);
const limits = new AuthLimits(db, process.env.BETTER_AUTH_SECRET);
const base = 'http://127.0.0.1:4321';
let attempt = 0;
const login = async (xff, extra = {}) => {
  const headers = { origin: 'https://localhost', 'content-type': 'application/json', ...extra };
  if (xff !== undefined) headers['x-forwarded-for'] = xff;
  return fetch(base + '/api/auth/sign-in/email', {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'proxy-smoke-' + attempt++ + '@example.test', password: 'synthetic-password-only' }),
  });
};
try {
  const deadline = Date.now() + 10000;
  while (true) {
    try { if ((await fetch(base + '/api/ready')).status === 200) break; } catch {}
    if (Date.now() >= deadline) throw new Error('proxy runtime did not become ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await login(undefined)).status, 400, 'missing XFF must fail closed');
  assert.equal((await login('unknown')).status, 400, 'invalid XFF must fail closed');
  assert.equal((await login('192.0.2.1')).status, 401);
  assert.equal((await login('192.0.2.2', { 'x-miaou-client-ip': '198.51.100.9' })).status, 401);
  const rows = (await pool.query('select key, events from auth_limit')).rows;
  for (const ip of ['192.0.2.1', '192.0.2.2'])
    assert.equal(rows.find(row => row.key === limits.key('ip:login:' + ip))?.events.length, 1, 'client IP must own its counter');
  assert.equal(rows.some(row => row.key === limits.key('ip:login:198.51.100.9')), false, 'caller-supplied internal header must be ignored');
  assert.equal((await login('203.0.113.99,192.0.2.2,127.0.0.1', { 'x-miaou-client-ip': '198.51.100.9' })).status, 401);
  const duplicatePayload = Buffer.from(JSON.stringify({ email: 'proxy-smoke-' + attempt++ + '@example.test', password: 'synthetic-password-only' }));
  const duplicateStatus = await new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: 4321, path: '/api/auth/sign-in/email', method: 'POST',
      headers: [
        'Host', 'localhost', 'Origin', 'https://localhost',
        'Content-Type', 'application/json', 'Content-Length', String(duplicatePayload.length),
        'X-Forwarded-For', '203.0.113.77',
        'X-Forwarded-For', '192.0.2.2,127.0.0.1',
      ],
    }, async response => {
      try {
        for await (const _chunk of response) {}
        resolve(response.statusCode);
      } catch (error) { reject(error); }
    });
    req.once('error', reject);
    req.end(duplicatePayload);
  });
  assert.equal(duplicateStatus, 401, 'duplicate XFF fields must preserve chain order');
  for (let index = 1; index < 60; index++) assert.equal((await login('192.0.2.1')).status, 401);
  const limited = await login('192.0.2.1');
  assert.equal(limited.status, 429, '61st attempt for one client must be limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0, 'rate limit must include retry-after');
  assert.equal((await login('192.0.2.2')).status, 401, 'second client counter must remain independent');
  const finalRows = (await pool.query('select key, events from auth_limit')).rows;
  assert.equal(finalRows.find(row => row.key === limits.key('ip:login:192.0.2.1'))?.events.length, 60);
  assert.equal(finalRows.find(row => row.key === limits.key('ip:login:192.0.2.2'))?.events.length, 4);
  assert.equal(finalRows.some(row => row.key === limits.key('ip:login:203.0.113.77')), false, 'forwarded prefix must not become client IP');
  assert.equal((await fetch(base + '/api/ready')).status, 200, 'readiness must not require XFF');
  console.log('Trusted proxy smoke: fail-closed XFF, independent PostgreSQL counters, spoofed headers ignored, duplicate XFF ordered, 60/61 limit and readiness passed');
} finally {
  await pool.end();
}
`;
  console.log(
    runInput(
      ["exec", "-i", container, "node", "--input-type=module"],
      proxyProof,
    ).trim(),
  );
  // Diagnostic activation is independent of proxy trust and affects only ready GETs.
  run(["rm", "-f", container]);
  const probeToken = randomBytes(32).toString("hex");
  const probeHash = createHash("sha256").update(probeToken).digest("hex");
  run([
    "run",
    "-d",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `DATABASE_URL=${dockerURL.href}`,
    "-e",
    `BETTER_AUTH_SECRET=${authSecret}`,
    "-e",
    "BETTER_AUTH_URL=https://localhost",
    "-e",
    "MIAOU_TRUSTED_PROXY_CIDRS=",
    "-e",
    `MIAOU_PROXY_PROBE_SHA256=${probeHash}`,
    "-e",
    `MIAOU_PROXY_PROBE_EXPIRES_AT=${Date.now() + 600000}`,
    image,
  ]);
  const diagnosticProof = String.raw`
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createHmac } from 'node:crypto';
const capability = process.env.MIAOU_SMOKE_PROBE_TOKEN;
const base = 'http://127.0.0.1:4321';
const deadline = Date.now() + 10000;
while (true) {
  try { if ((await fetch(base + '/api/ready')).status === 200) break; } catch {}
  if (Date.now() >= deadline) throw new Error('diagnostic runtime did not become ready');
  await new Promise(resolve => setTimeout(resolve, 100));
}
const baseline = await fetch(base + '/api/ready');
const body = await baseline.text();
const observed = await new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: 4321, path: '/api/ready', headers: [
    'Host', 'localhost', 'X-Miaou-Proxy-Probe', capability,
    'X-Forwarded-For', '203.0.113.99', 'X-Forwarded-For', '192.0.2.1',
  ] }, res => { let body = ''; res.on('data', part => { body += part; });
    res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  }); req.on('error', reject); req.end();
});
assert.equal(observed.status, 200); assert.equal(observed.body, body);
for (const name of ['cache-control', 'content-type', 'x-content-type-options', 'referrer-policy'])
  assert.equal(observed.headers[name], baseline.headers.get(name));
for (const headers of [
  { 'x-miaou-proxy-probe': '0'.repeat(64) },
  { 'x-miaou-proxy-probe': capability, cookie: 'synthetic-cookie=not-a-session' },
]) assert.equal((await fetch(base + '/api/ready', { headers })).status, 200);
assert.equal((await fetch(base + '/api/ready?probe=synthetic', { headers: { 'x-miaou-proxy-probe': capability } })).status, 200);
const fingerprint = value => createHmac('sha256', Buffer.from(capability, 'hex')).update('miaou-proxy-probe-v1:' + value).digest('hex');
console.log(JSON.stringify({ requestId: observed.headers['x-request-id'], fingerprints: ['203.0.113.99', '192.0.2.1'].map(fingerprint) }));
`;
  const diagnostic = JSON.parse(
    runInput(
      [
        "exec",
        "-i",
        "-e",
        "MIAOU_SMOKE_PROBE_TOKEN",
        container,
        "node",
        "--input-type=module",
      ],
      diagnosticProof,
      { MIAOU_SMOKE_PROBE_TOKEN: probeToken },
    ),
  );
  const rawLogs = run(["logs", container]);
  const records = rawLogs.split("\n").flatMap((line) => {
    try {
      const record = JSON.parse(line);
      return record.event === "proxy_probe" ? [record] : [];
    } catch {
      return [];
    }
  });
  if (
    records.length !== 1 ||
    records[0].requestId !== diagnostic.requestId ||
    records[0].xffFields !== 2 ||
    records[0].headerTrust !== "observed_untrusted" ||
    JSON.stringify(
      records[0].forwarded.entries.map((entry) => entry.fingerprint),
    ) !== JSON.stringify(diagnostic.fingerprints)
  )
    throw new Error("Diagnostic runtime observation mismatch");
  for (const value of [
    probeToken,
    "synthetic-cookie",
    "203.0.113.99",
    "192.0.2.1",
  ])
    if (rawLogs.includes(value))
      throw new Error("Diagnostic runtime sensitive value leak");
  console.log(
    "Proxy diagnostic smoke: unchanged real readiness, duplicate XFF pseudonyms, capability/credential/route refusals and no sensitive logs passed",
  );
} finally {
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  } catch {
    /* container never started */
  }
  if (database) await closePool(database.pool);
  await admin.pool.query(`drop database if exists "${name}" with (force)`);
  await closePool(admin.pool);
}
