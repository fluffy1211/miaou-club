import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withRenderPaused } from "../scripts/backup-render-quiescence.mjs";

const digest = "sha256:" + "a".repeat(64);
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(
    join(await realpath(tmpdir()), "miaou-render-pause-"),
  );
  const tokenFile = join(dir, "token");
  await writeFile(tokenFile, "synthetic-private-token", { mode: 0o600 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [],
    events = [];
  let suspended = false;
  const service = {
    id: "srv-" + "a".repeat(20),
    name: "miaou-preproduction",
    type: "web_service",
    suspended: "not_suspended",
    autoDeploy: "no",
    autoDeployTrigger: "off",
    imagePath: "ghcr.io/synthetic/miaou@" + digest,
    serviceDetails: {
      region: "frankfurt",
      plan: "free",
      url: "https://miaou.example.test",
    },
  };
  const options = {
    allowPause: true,
    expectedScope: "closed-preproduction",
    serviceId: service.id,
    serviceName: service.name,
    origin: service.serviceDetails.url,
    expectedDigest: digest,
    tokenFile,
    timeoutMs: 300,
    fetch: async (url, init) => {
      calls.push([url, init.method]);
      assert.equal(init.redirect, "error");
      if (url.startsWith("https://api.render.com/"))
        assert.equal(
          init.headers.authorization,
          "Bearer synthetic-private-token",
        );
      else assert.equal(init.headers.authorization, undefined);
      if (url.endsWith("/suspend")) {
        events.push("suspend");
        suspended = true;
        if (overrides.lostSuspend) throw Error("private-provider-detail");
        return new Response(null, { status: 202 });
      }
      if (url.endsWith("/resume")) {
        events.push("resume");
        suspended = false;
        if (overrides.lostResume) throw Error("private-provider-detail");
        return new Response(null, { status: 202 });
      }
      if (url.endsWith("/instances"))
        return Response.json(
          suspended
            ? []
            : [
                {
                  id: "instance-synthetic",
                  createdAt: new Date().toISOString(),
                },
              ],
        );
      if (url.includes("/deploys?"))
        return Response.json([
          {
            deploy: {
              status: "live",
              image: { sha: overrides.digest ?? digest },
            },
          },
        ]);
      if (url.endsWith("/api/ready"))
        return Response.json(
          { ready: true },
          { headers: { "cache-control": overrides.readyCache ?? "no-store" } },
        );
      return overrides.large
        ? new Response("x".repeat(65537))
        : Response.json({
            ...service,
            suspended:
              suspended || overrides.initialSuspended
                ? "suspended"
                : "not_suspended",
            ...overrides.service,
          });
    },
  };
  return { options, calls, events, service };
}

test("pause confirmed with no instances, copy, resume and readiness; token stays on Render API", async (t) => {
  const f = await fixture(t);
  const result = await withRenderPaused(f.options, async ({ signal }) => {
    assert.equal(signal.aborted, false);
    assert.deepEqual(f.events, ["suspend"]);
    assert.ok(f.calls.at(-1)[0].endsWith("/instances"));
    f.events.push("copy");
    return "receipt";
  });
  assert.deepEqual(f.events, ["suspend", "copy", "resume"]);
  assert.equal(result.code, "render_pause_ok");
  assert.equal(result.recovered, true);
  assert.equal(result.value, "receipt");
  assert.ok(Date.parse(result.resumedAt) >= Date.parse(result.pauseStartedAt));
  assert.equal(f.calls.filter(([, method]) => method === "POST").length, 2);
});

test("task failure resumes and errors contain only safe technical status", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    withRenderPaused(f.options, async () => {
      throw Error("private-source-detail");
    }),
    (e) => {
      assert.equal(e.message, "Render backup pause failed");
      assert.equal(e.status.recovered, true);
      assert.equal(JSON.stringify(e).includes("private"), false);
      return true;
    },
  );
  assert.deepEqual(f.events, ["suspend", "resume"]);
});

test("lost suspend response still attempts exactly one resume without copying", async (t) => {
  const f = await fixture(t, { lostSuspend: true });
  await assert.rejects(
    withRenderPaused(f.options, async () => assert.fail("must not capture")),
    (e) => e.status.recovered === true,
  );
  assert.deepEqual(f.events, ["suspend", "resume"]);
});

test("lost resume response is reconciled through GET without resending mutation", async (t) => {
  const f = await fixture(t, { lostResume: true });
  assert.equal(
    (await withRenderPaused(f.options, async () => null)).recovered,
    true,
  );
  assert.deepEqual(f.events, ["suspend", "resume"]);
});

test("copy waits until the suspended service has no remaining instances", async (t) => {
  const f = await fixture(t);
  f.options.timeoutMs = 1000;
  const request = f.options.fetch;
  let observations = 0;
  f.options.fetch = async (url, init) => {
    const response = await request(url, init);
    if (url.endsWith("/instances") && !f.events.includes("resume")) {
      observations += 1;
      if (observations === 1) return Response.json([{ id: "still-stopping" }]);
    }
    return response;
  };
  await withRenderPaused(f.options, async () => assert.equal(observations, 2));
  assert.deepEqual(f.events, ["suspend", "resume"]);
});

test("initially suspended service and wrong deployment digest refuse every POST", async (t) => {
  for (const config of [
    { initialSuspended: true },
    { digest: "sha256:" + "b".repeat(64) },
  ]) {
    const f = await fixture(t, config);
    await assert.rejects(
      withRenderPaused(f.options, async () => assert.fail()),
    );
    assert.deepEqual(f.events, []);
  }
});

test("identity, region, plan, autodeploy and explicit scope are fail-closed before mutation", async (t) => {
  for (const service of [
    { id: "wrong" },
    { name: "wrong" },
    { type: "private_service" },
    { autoDeploy: "yes" },
    { autoDeployTrigger: "commit" },
    {
      serviceDetails: {
        region: "oregon",
        plan: "free",
        url: "https://miaou.example.test",
      },
    },
    {
      serviceDetails: {
        region: "frankfurt",
        plan: "starter",
        url: "https://miaou.example.test",
      },
    },
    {
      serviceDetails: {
        region: "frankfurt",
        plan: "free",
        url: "https://other.example.test",
      },
    },
  ]) {
    const f = await fixture(t, { service });
    await assert.rejects(
      withRenderPaused(f.options, async () => assert.fail()),
    );
    assert.deepEqual(f.events, []);
  }
  const f = await fixture(t);
  for (const config of [{ allowPause: false }, { expectedScope: undefined }]) {
    await assert.rejects(
      withRenderPaused({ ...f.options, ...config }, async () => assert.fail()),
    );
    assert.deepEqual(f.calls, []);
  }
});

test("deadline aborts the task but awaits settlement before resuming the source writer", async (t) => {
  const f = await fixture(t);
  f.options.timeoutMs = 30;
  await assert.rejects(
    withRenderPaused(f.options, async ({ signal }) => {
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      f.events.push("aborted");
      await delay(30);
      assert.equal(f.events.includes("resume"), false);
      f.events.push("settled");
    }),
    (e) => e.status.recovered === true,
  );
  assert.deepEqual(f.events, ["suspend", "aborted", "settled", "resume"]);
});

test("oversized API response is refused without mutation and readiness must forbid storage", async (t) => {
  const f = await fixture(t, { large: true });
  await assert.rejects(withRenderPaused(f.options, async () => assert.fail()));
  assert.deepEqual(f.events, []);
  const g = await fixture(t, { readyCache: "public" });
  g.options.timeoutMs = 30;
  await assert.rejects(
    withRenderPaused(g.options, async () => null),
    (e) => e.status.pauseAttempted && !e.status.recovered,
  );
  assert.deepEqual(g.events, ["suspend", "resume"]);
});
