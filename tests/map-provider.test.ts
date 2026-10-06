import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPlaces, tileURL } from "../src/lib/map-provider.ts";
test("provider navigation sends only query and static options, without position, identity, post or cookies", async () => {
  let called = false;
  const fetcher: typeof fetch = async (input, init) => {
    called = true;
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.maptiler.com");
    assert.equal(url.pathname, "/geocoding/Bagneux.json");
    assert.deepEqual([...url.searchParams.keys()].sort(), [
      "country",
      "key",
      "language",
      "limit",
      "types",
    ]);
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.equal(init?.cache, "no-store");
    return new Response(
      JSON.stringify({
        features: [
          { place_name: "Synthetic city", center: [2.3, 48.8] },
          { place_name: "Invalid", center: [null, 1] },
        ],
      }),
    );
  };
  const places = await searchPlaces(
    "Bagneux",
    "synthetic-map-key",
    undefined,
    fetcher,
  );
  assert.equal(called, true);
  assert.deepEqual(places, [{ name: "Synthetic city", center: [2.3, 48.8] }]);
  assert.ok(tileURL("synthetic-map-key").includes("/{z}/{x}/{y}.png"));
  await assert.rejects(() =>
    searchPlaces("x", "synthetic", undefined, fetcher),
  );
  await assert.rejects(() =>
    searchPlaces(
      "Bagneux",
      "synthetic",
      undefined,
      async () => new Response("", { status: 429 }),
    ),
  );
});
