import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchApi } from "../src/lib/api-client.ts";
import {
  apiCoat,
  catApiSchema,
  frenchTemperament,
  plainText,
  catalogRecords,
} from "../src/lib/breed-api.ts";
const now = Date.parse("2026-10-02T12:00:00Z");
const url = "https://api.example.test/breeds";
const parse = (value: unknown) => {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
    throw new Error("Invalid response");
  return value as string[];
};
test("valid API responses are cached for 24h without authentication headers", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "miaou-api-test-"));
  try {
    let requests = 0;
    const fetcher: typeof fetch = async (_url, options) => {
      requests++;
      assert.equal(
        (options!.headers as Record<string, string>)["x-api-key"],
        "test-secret",
      );
      return new Response(JSON.stringify(["real-response"]), { status: 200 });
    };
    const options = {
      name: "breeds",
      url,
      parse,
      fetcher,
      cacheDir,
      now,
      headers: { "x-api-key": "test-secret" },
      refresh: false,
    };
    await fetchApi(options);
    assert.deepEqual(
      (await fetchApi({ ...options, now: now + 60_000 })).payload,
      ["real-response"],
    );
    assert.equal(requests, 1);
    assert.equal(
      (await readFile(join(cacheDir, "breeds.json"), "utf8")).includes(
        "test-secret",
      ),
      false,
    );
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
test("expired cache can cover an outage, forced refresh fails and reports no fabricated data", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "miaou-api-test-"));
  try {
    const fetchedAt = new Date(now - 2 * 86_400_000).toISOString();
    await writeFile(
      join(cacheDir, "breeds.json"),
      JSON.stringify({ url, fetchedAt, payload: ["cached-api-response"] }),
    );
    const warnings: string[] = [];
    const fetcher: typeof fetch = async () => new Response("", { status: 503 });
    const options = {
      name: "breeds",
      url,
      parse,
      fetcher,
      cacheDir,
      now,
      refresh: false,
      warn: (s: string) => warnings.push(s),
    };
    assert.equal((await fetchApi(options)).fetchedAt, fetchedAt);
    assert.equal(warnings.length, 1);
    await assert.rejects(fetchApi({ ...options, refresh: true }), /HTTP 503/);
    await assert.rejects(
      fetchApi({ ...options, now: now + 8 * 86_400_000 }),
      /HTTP 503/,
    );
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
test("invalid API payload and corrupt cache cannot silently become catalogue entries", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "miaou-api-test-"));
  try {
    await writeFile(join(cacheDir, "breeds.json"), "broken json");
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "not a list" }));
    await assert.rejects(
      fetchApi({
        name: "breeds",
        url,
        parse,
        fetcher,
        cacheDir,
        now,
        refresh: false,
      }),
      /Invalid response/,
    );
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
test("real provider fields map to French without inventing unknown categories", () => {
  assert.equal(apiCoat("Long-haired"), "long");
  assert.equal(apiCoat("Short-haired"), "short");
  assert.equal(apiCoat("Semi-longhair"), "medium");
  assert.equal(apiCoat("Hairless"), "hairless");
  assert.equal(apiCoat("Rex"), "curly");
  assert.equal(apiCoat("Short/Long-hair"), "mixed");
  assert.equal(apiCoat("Hybrid"), "unknown");
  assert.throws(() => apiCoat("Unrecognised coat"));
  assert.equal(
    frenchTemperament("Loving, Affectionate, Playful"),
    "Affectueux, Joueur.",
  );
  assert.throws(() => frenchTemperament("Unrecognised trait"), /à traduire/);
  assert.equal(
    plainText('<a href="/user">Author &amp; friend</a>'),
    "Author & friend",
  );
});
test("expanded catalogue excludes duplicates, non-breeds and malformed provider entries", () => {
  const breed = {
    id: "abys",
    name: "Abyssinian",
    origin: "Egypt",
    breed_group: "Short-haired",
    life_span: "14-17",
    temperament: "Active",
    weight: { metric: "3.6-5.4" },
  };
  const records = [
    breed,
    { ...breed, id: "aege", name: "Aegean", life_span: "9-12" },
    { ...breed, id: "duplicate" },
    { ...breed, id: "poly", name: "Polydactyl" },
    { ...breed, id: "bad", name: "Bad", weight: { metric: "Good with dogs" } },
    { ...breed, id: "missing", name: "Missing", origin: null },
  ];
  assert.deepEqual(
    catalogRecords(records).map((b) => b.id),
    ["abys", "aege"],
  );
});
test("nullable fields on unrelated API breeds do not invalidate the complete response", () => {
  const response = [
    {
      id: "other",
      name: "Other",
      origin: null,
      breed_group: null,
      life_span: "12-15",
      temperament: "Gentle",
    },
  ];
  assert.equal(catApiSchema.parse(response)[0].origin, null);
  assert.throws(() => catApiSchema.parse([{ id: "other" }]));
});

test("offline builds validate recorded data and refuse missing/corrupt snapshots without network", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "miaou-offline-test-"));
  try {
    let calls = 0;
    const options = {
      name: "breeds",
      url,
      parse,
      cacheDir,
      now,
      offline: true,
      fetcher: async () => {
        calls++;
        return new Response("[]");
      },
    };
    await assert.rejects(
      fetchApi(options),
      /Missing or invalid recorded API response/,
    );
    await writeFile(
      join(cacheDir, "breeds.json"),
      JSON.stringify({
        url,
        fetchedAt: new Date(now - 30 * 86_400_000).toISOString(),
        payload: ["recorded-provider-value"],
      }),
    );
    assert.deepEqual((await fetchApi(options)).payload, [
      "recorded-provider-value",
    ]);
    await writeFile(
      join(cacheDir, "breeds.json"),
      JSON.stringify({
        url,
        fetchedAt: new Date(now).toISOString(),
        payload: {},
      }),
    );
    await assert.rejects(
      fetchApi(options),
      /Missing or invalid recorded API response/,
    );
    assert.equal(calls, 0);
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
