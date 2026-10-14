import test from "node:test";
import assert from "node:assert/strict";
import { createClientIPResolver } from "../server/client-ip.mjs";
const trust = "10.20.0.0/16,2001:db8:abcd::/48";

test("direct mode ignores spoofed headers and normalizes IP identity", () => {
  const resolve = createClientIPResolver();
  assert.equal(resolve("192.0.2.1", "198.51.100.1"), "192.0.2.1");
  assert.equal(resolve("::ffff:192.0.2.1", "198.51.100.1"), "192.0.2.1");
  assert.equal(resolve("2001:0db8:0000::1", "198.51.100.1"), "2001:db8::1");
  assert.equal(resolve(undefined, "198.51.100.1"), null);
});

test("untrusted sockets cannot choose their network counter", () => {
  const resolve = createClientIPResolver(trust);
  assert.equal(resolve("192.0.2.1", "198.51.100.1,10.20.1.1"), "192.0.2.1");
  assert.equal(resolve("10.21.1.1", "198.51.100.1"), "10.21.1.1");
});

test("walks trusted chain from right, ignoring a forged left prefix", () => {
  const resolve = createClientIPResolver(trust);
  assert.equal(
    resolve("10.20.1.2", "203.0.113.99,192.0.2.1,10.20.1.1"),
    "192.0.2.1",
  );
  assert.equal(
    resolve("10.20.1.2", "203.0.113.99,198.51.100.1,10.20.1.1"),
    "198.51.100.1",
  );
  assert.equal(
    resolve("2001:db8:abcd::2", "::ffff:192.0.2.1,2001:db8:abcd::1"),
    "192.0.2.1",
  );
});

test("stops at first untrusted proxy even if earlier entries claim a client", () => {
  assert.equal(
    createClientIPResolver(trust)(
      "10.20.1.2",
      "192.0.2.1,198.51.100.1,10.20.1.1",
    ),
    "198.51.100.1",
  );
});

test("trusted peer requires a bounded, valid chain with an identifiable client", () => {
  const resolve = createClientIPResolver(trust);
  for (const input of [
    undefined,
    "",
    "unknown",
    "192.0.2.1,",
    "192.0.2.1:443",
    "for=192.0.2.1",
    "10.20.1.1",
    ["192.0.2.1"],
    "192.0.2.1,".repeat(33),
    " ".repeat(4097),
    "fe80::1%eth0",
  ]) {
    assert.equal(resolve("10.20.1.2", input), null);
  }
});

test("invalid or all-network trust configuration fails at startup", () => {
  for (const input of [
    " ",
    "0.0.0.0/0",
    "::/0",
    "10.20.0.0/33",
    "2001:db8::/129",
    "10.20.1.1",
    "10.20.0.0/16,",
    "::ffff:10.20.0.0/112",
    "fe80::1%eth0/64",
  ]) {
    assert.throws(
      () => createClientIPResolver(input),
      /Invalid trusted proxy CIDRs/,
    );
  }
});
