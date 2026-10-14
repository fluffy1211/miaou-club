import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/components/encounter-api.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { encounterAPI } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const { isForbiddenCrossOriginRequest } = await import(
  new URL(
    "../node_modules/astro/dist/core/app/origin-check.js",
    import.meta.url,
  ).href
);

test("HTTPS browser mutations survive Astro's HTTP proxy request URL", async () => {
  const original = globalThis.fetch;
  const url = new URL("http://preproduction.example/api/v1/media/synthetic");
  const origin = "https://preproduction.example";
  for (const method of ["POST", "DELETE"]) {
    assert.equal(
      isForbiddenCrossOriginRequest(
        new Request(url, { method, headers: { origin } }),
        url,
        false,
      ),
      true,
    );
  }
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    assert.equal(
      isForbiddenCrossOriginRequest(
        new Request(url, { ...init, headers }),
        url,
        false,
      ),
      false,
    );
    return Response.json({ status: true });
  };
  try {
    await encounterAPI("/api/v1/media/synthetic/retry", { method: "POST" });
    await encounterAPI("/api/v1/media/synthetic", { method: "DELETE" });
  } finally {
    globalThis.fetch = original;
  }
});

test("bodyless mutations declare JSON while preserving caller headers and method", async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init!);
    return Response.json({ status: true });
  };
  try {
    for (const method of ["DELETE", "POST", "patch"]) {
      const headers = new Headers({ "x-request-proof": "synthetic" });
      await encounterAPI("/api/v1/media/synthetic", { method, headers });
      const call = calls.at(-1)!;
      assert.equal(call.method, method);
      assert.equal(
        new Headers(call.headers).get("content-type"),
        "application/json",
      );
      assert.equal(
        new Headers(call.headers).get("x-request-proof"),
        "synthetic",
      );
      assert.equal(headers.has("content-type"), false);
      assert.equal(call.body, undefined);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("safe reads, multipart photos and explicit content types retain their transport", async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init!);
    return Response.json({ status: true });
  };
  try {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      await encounterAPI("/api/v1/me", { method });
      assert.equal(
        new Headers(calls.at(-1)!.headers).has("content-type"),
        false,
      );
    }
    const photo = new FormData();
    photo.set("photo", new Blob(["synthetic"]));
    await encounterAPI("/api/v1/media", { method: "POST", body: photo });
    assert.equal(calls.at(-1)!.body, photo);
    assert.equal(new Headers(calls.at(-1)!.headers).has("content-type"), false);
    await encounterAPI("/api/v1/media", {
      method: "POST",
      headers: [["Content-Type", "application/octet-stream"]],
    });
    assert.equal(
      new Headers(calls.at(-1)!.headers).get("content-type"),
      "application/octet-stream",
    );
  } finally {
    globalThis.fetch = original;
  }
});
