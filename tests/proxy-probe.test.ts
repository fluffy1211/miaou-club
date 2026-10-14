import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import {
  createProxyProbe,
  parseProxyProbeEnv,
} from "../server/proxy-probe.mjs";

type ProbeRequest = {
  method: string;
  url: string;
  socket: { remoteAddress: string };
  headers: Record<string, unknown>;
  rawHeaders: string[];
};
type AddressObservation = {
  family?: number;
  fingerprint?: string;
  invalid?: boolean;
};
type ProbeRecord = {
  socket: AddressObservation;
  forwarded: { state: string; entries: AddressObservation[] };
  cfConnectingIP: AddressObservation;
  trueClientIP: AddressObservation;
  headerTrust: string;
  xffFields: number;
};
const capability = randomBytes(32).toString("hex");
const config = () => ({
  capabilityDigest: createHash("sha256").update(capability).digest("hex"),
  expiresAt: Date.now() + 60000,
});
function req(overrides: Partial<ProbeRequest> = {}): ProbeRequest {
  return {
    method: "GET",
    url: "/api/ready",
    socket: { remoteAddress: "::ffff:10.20.1.2" },
    headers: {
      "x-miaou-proxy-probe": capability,
      "x-forwarded-for": "192.0.2.1, 10.20.1.2",
    },
    rawHeaders: [
      "X-Miaou-Proxy-Probe",
      capability,
      "X-Forwarded-For",
      "192.0.2.1, 10.20.1.2",
    ],
    ...overrides,
  };
}
function observe(
  probe: ReturnType<typeof createProxyProbe>,
  input: ProbeRequest,
  records: ProbeRecord[],
) {
  const res = new EventEmitter();
  const before = records.length;
  probe(input, res, "synthetic-request-id");
  assert.equal(records.length, before, "no log before response finishes");
  res.emit("finish");
  assert.equal(input.headers["x-miaou-proxy-probe"], undefined);
  assert.ok(!input.rawHeaders.includes(capability));
}
function capture(t: TestContext) {
  const records: ProbeRecord[] = [];
  t.mock.method(console, "log", (value: string) =>
    records.push(JSON.parse(value)),
  );
  return records;
}
test("disabled, invalid and expired configuration emits nothing and strips capability", (t) => {
  const records = capture(t);
  for (const opts of [
    undefined,
    {},
    { ...config(), expiresAt: 1 },
    { ...config(), capabilityDigest: "bad" },
    { ...config(), expiresAt: Date.now() + 16 * 60000 },
  ])
    observe(createProxyProbe(opts), req(), records);
  assert.equal(records.length, 0);
});
test("capability, exact route, method and absence of credentials are mandatory", (t) => {
  const records = capture(t);
  const probe = createProxyProbe(config());
  for (const overrides of [
    { method: "POST" },
    { url: "/api/ready?x=1" },
    { url: "/api/%72eady" },
    { url: "/api/auth/sign-in/email" },
    { headers: {} },
    { headers: { "x-miaou-proxy-probe": "0".repeat(64) } },
    ...["cookie", "authorization", "proxy-authorization"].map((name) => ({
      headers: {
        "x-miaou-proxy-probe": capability,
        [name]: "synthetic-secret",
      },
    })),
    {
      rawHeaders: [
        "X-Miaou-Proxy-Probe",
        capability,
        "x-miaou-proxy-probe",
        capability,
      ],
    },
  ])
    observe(probe, req(overrides), records);
  assert.equal(records.length, 0);
});
test("ordered pseudonyms normalize mapped IPv4 and do not serialize sensitive input", (t) => {
  const records = capture(t);
  const input = req();
  input.headers["cf-connecting-ip"] = "192.0.2.1";
  input.headers["true-client-ip"] = "203.0.113.99";
  input.headers["x-unrelated-secret"] = "synthetic-secret";
  observe(createProxyProbe(config()), input, records);
  const record = records[0];
  assert.equal(
    record.socket.fingerprint,
    record.forwarded.entries[1].fingerprint,
  );
  assert.equal(
    record.cfConnectingIP.fingerprint,
    record.forwarded.entries[0].fingerprint,
  );
  assert.notEqual(
    record.trueClientIP.fingerprint,
    record.cfConnectingIP.fingerprint,
  );
  assert.equal(record.headerTrust, "observed_untrusted");
  const json = JSON.stringify(record);
  for (const value of [
    capability,
    "192.0.2.1",
    "10.20.1.2",
    "203.0.113.99",
    "synthetic-secret",
  ])
    assert.ok(!json.includes(value));
});
test("XFF states and per-process budget are bounded", (t) => {
  const records = capture(t);
  const probe = createProxyProbe(config());
  const values = [
    undefined,
    ["192.0.2.1"],
    " ".repeat(4097),
    Array(33).fill("192.0.2.1").join(","),
    "bad,192.0.2.1",
  ];
  for (const value of values)
    observe(
      probe,
      req({
        headers: {
          "x-miaou-proxy-probe": capability,
          "x-forwarded-for": value,
        },
      }),
      records,
    );
  assert.deepEqual(
    records.map((r) => r.forwarded.state),
    ["missing", "invalid", "excessive", "excessive", "observed"],
  );
  assert.deepEqual(records[4].forwarded.entries[0], { invalid: true });
  for (let i = 0; i < 20; i++) observe(probe, req(), records);
  assert.equal(records.length, 16);
});
test("absolute expiry still applies after startup", (t) => {
  const records = capture(t);
  const now = Date.now();
  const probe = createProxyProbe({ ...config(), expiresAt: now + 1000 });
  t.mock.method(Date, "now", () => now + 1001);
  observe(probe, req(), records);
  assert.equal(records.length, 0);
});
test("monotonic deadline prevents an extended window after clock rollback", (t) => {
  const records = capture(t);
  const clock = performance.now();
  const probe = createProxyProbe({ ...config(), expiresAt: Date.now() + 1000 });
  t.mock.method(Date, "now", () => 1);
  t.mock.method(performance, "now", () => clock + 2000);
  observe(probe, req(), records);
  assert.equal(records.length, 0);
});
test("logging failure cannot escape finish listener", (t) => {
  t.mock.method(console, "log", () => {
    throw Error("synthetic log failure");
  });
  const res = new EventEmitter();
  createProxyProbe(config())(req(), res, "synthetic-request-id");
  assert.doesNotThrow(() => res.emit("finish"));
});
test("real Node HTTP duplicate XFF is observed without modifying response or headers", async (t) => {
  const records = capture(t);
  const probe = createProxyProbe(config());
  const server = createServer((input, res) => {
    probe(input, res, "synthetic-node-request-id");
    assert.equal(input.headers["x-miaou-proxy-probe"], undefined);
    res.writeHead(200, { "Cache-Control": "no-store" });
    res.end("synthetic-ready");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await new Promise<{
      status: number | undefined;
      headers: IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      const r = request(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/api/ready",
          headers: [
            "Host",
            "127.0.0.1",
            "X-Miaou-Proxy-Probe",
            capability,
            "X-Forwarded-For",
            "203.0.113.99",
            "X-Forwarded-For",
            "192.0.2.1",
          ],
        },
        (res) => {
          let body = "";
          res.on("data", (part) => {
            body += part;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    });
    assert.equal(response.status, 200);
    assert.equal(response.body, "synthetic-ready");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(!JSON.stringify(response).includes(capability));
    assert.equal(records.length, 1);
    assert.equal(records[0].xffFields, 2);
    assert.equal(records[0].forwarded.entries.length, 2);
    assert.notEqual(
      records[0].forwarded.entries[0].fingerprint,
      records[0].forwarded.entries[1].fingerprint,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("explicit environment parsing rejects incomplete, expired or noncanonical configuration", () => {
  const now = 1800000000000;
  const hash = createHash("sha256").update(capability).digest("hex");
  const valid = {
    MIAOU_PROXY_PROBE_SHA256: hash,
    MIAOU_PROXY_PROBE_EXPIRES_AT: String(now + 1000),
  };
  assert.deepEqual(parseProxyProbeEnv({}, now), {
    capabilityDigest: "",
    expiresAt: 0,
  });
  assert.deepEqual(
    parseProxyProbeEnv(
      { MIAOU_PROXY_PROBE_SHA256: "", MIAOU_PROXY_PROBE_EXPIRES_AT: "" },
      now,
    ),
    { capabilityDigest: "", expiresAt: 0 },
  );
  assert.deepEqual(parseProxyProbeEnv(valid, now), {
    capabilityDigest: hash,
    expiresAt: now + 1000,
  });
  for (const invalid of [
    { MIAOU_PROXY_PROBE_SHA256: hash },
    { MIAOU_PROXY_PROBE_EXPIRES_AT: String(now + 1000) },
    { ...valid, MIAOU_PROXY_PROBE_SHA256: "not-a-hash" },
    { ...valid, MIAOU_PROXY_PROBE_SHA256: 1 },
    ...[
      "",
      " 1800000001000",
      "01800000001000",
      "1e12",
      "+1800000001000",
      "1800000001000.0",
      String(now),
      String(now + 900001),
      "9007199254740992",
      1800000001000,
    ].map((expiry) => ({ ...valid, MIAOU_PROXY_PROBE_EXPIRES_AT: expiry })),
  ])
    assert.equal(parseProxyProbeEnv(invalid, now), null);
});
