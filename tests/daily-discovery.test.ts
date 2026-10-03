import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyDiscoveryIds } from "../src/lib/daily-discovery.ts";

test("daily discoveries are stable for one day and contain three distinct breeds", () => {
  const ids = ["maine-coon", "siamese", "bengal", "persian", "british"];
  const selection = dailyDiscoveryIds(ids, "2026-10-02");

  assert.deepEqual(selection, dailyDiscoveryIds(ids, "2026-10-02"));
  assert.equal(selection.length, 3);
  assert.equal(new Set(selection).size, 3);
  assert.ok(selection.every((id) => ids.includes(id)));
});

test("daily discoveries do not request more breeds than the catalogue contains", () => {
  assert.deepEqual(dailyDiscoveryIds(["siamese", "bengal"], "2026-10-02"), [
    "bengal",
    "siamese",
  ]);
});
