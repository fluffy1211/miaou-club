import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { privateFile } from "./remote-backup-repository.mjs";

// Preparation only: no invocation or scheduled task is installed by this module.
export async function withRenderPaused(options, task) {
  const {
    allowPause,
    expectedScope,
    serviceId,
    serviceName,
    origin,
    expectedDigest,
    tokenFile,
    fetch: request = globalThis.fetch,
    timeoutMs = 600000,
  } = options;
  const status = { code: "render_pause_failed", recovered: false };
  let attempted = false,
    failed = false,
    value;
  const { AbortController } = globalThis;
  const controller = new AbortController();
  let timer;
  try {
    assert.equal(allowPause, true);
    assert.equal(expectedScope, "closed-preproduction");
    assert.match(serviceId, /^srv-[a-z0-9]{20}$/);
    assert.ok(typeof serviceName === "string" && /preprod/i.test(serviceName));
    assert.match(expectedDigest, /^sha256:[a-f0-9]{64}$/);
    const u = new URL(origin);
    assert.ok(
      u.protocol === "https:" &&
        u.origin === origin &&
        !u.username &&
        !u.password,
    );
    assert.ok(
      Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3600000,
    );
    assert.ok((await privateFile(tokenFile)).size <= 4096);
    const token = (await readFile(tokenFile, "utf8")).trim();
    assert.match(token, /^[A-Za-z0-9._~-]{16,512}$/);
    const base = `https://api.render.com/v1/services/${serviceId}`;
    async function call(url, signal, method = "GET", api = true) {
      const local = new AbortController();
      const stop = () => local.abort();
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      const deadline = setTimeout(stop, Math.min(timeoutMs, 10000));
      try {
        const response = await request(url, {
          method,
          signal: local.signal,
          redirect: "error",
          headers: api
            ? { authorization: `Bearer ${token}`, accept: "application/json" }
            : {},
        });
        assert.equal(response.status, method === "POST" ? 202 : 200);
        let text = "",
          bytes = 0;
        const { TextDecoder } = globalThis;
        const decoder = new TextDecoder();
        if (response.body)
          for await (const chunk of response.body) {
            bytes += chunk.byteLength;
            assert.ok(bytes <= 65536);
            text += decoder.decode(chunk, { stream: true });
          }
        text += decoder.decode();
        if (!api)
          assert.ok(
            /(?:^|,)\s*no-store\s*(?:,|$)/i.test(
              response.headers.get("cache-control") || "",
            ),
          );
        return text ? JSON.parse(text) : null;
      } finally {
        local.abort();
        clearTimeout(deadline);
        signal.removeEventListener("abort", stop);
      }
    }
    async function identity(signal, suspended) {
      const s = await call(base, signal);
      assert.equal(s.id, serviceId);
      assert.equal(s.name, serviceName);
      assert.equal(s.type, "web_service");
      assert.equal(s.suspended, suspended);
      assert.equal(s.autoDeploy, "no");
      assert.ok(
        s.autoDeployTrigger === undefined || s.autoDeployTrigger === "off",
      );
      assert.equal(s.serviceDetails.region, "frankfurt");
      assert.equal(s.serviceDetails.plan, "free");
      assert.equal(s.serviceDetails.url, origin);
      if (s.imagePath?.includes("@sha256:"))
        assert.ok(s.imagePath.endsWith("@" + expectedDigest));
      if (suspended === "suspended") return;
      const deployments = await call(base + "/deploys?limit=1", signal);
      const d = deployments[0]?.deploy;
      assert.equal(d?.status, "live");
      assert.equal(d?.image?.sha, expectedDigest);
    }
    async function poll(signal, check) {
      while (true) {
        signal.throwIfAborted();
        try {
          if (await check()) return;
        } catch {
          signal.throwIfAborted();
        }
        await delay(250, undefined, { signal });
      }
    }
    timer = setTimeout(() => controller.abort(), timeoutMs);
    await identity(controller.signal, "not_suspended");
    attempted = true;
    status.pauseStartedAt = new Date().toISOString();
    try {
      await call(base + "/suspend", controller.signal, "POST");
      await poll(controller.signal, async () => {
        await identity(controller.signal, "suspended");
        const instances = await call(base + "/instances", controller.signal);
        return Array.isArray(instances) && instances.length === 0;
      });
      // Await settlement even after abort: the writer must not resume during capture.
      value = await task({ signal: controller.signal });
      controller.signal.throwIfAborted();
    } catch {
      failed = true;
    } finally {
      clearTimeout(timer);
      controller.abort();
      const recovery = new AbortController();
      timer = setTimeout(() => recovery.abort(), timeoutMs);
      try {
        try {
          await call(base + "/resume", recovery.signal, "POST");
        } catch {
          /* A lost response may still have resumed the service. */
        }
        await poll(recovery.signal, async () => {
          await identity(recovery.signal, "not_suspended");
          const instances = await call(base + "/instances", recovery.signal);
          if (!Array.isArray(instances) || instances.length === 0) return false;
          await call(origin + "/api/ready", recovery.signal, "GET", false);
          return true;
        });
        status.recovered = true;
        status.resumedAt = new Date().toISOString();
      } catch {
        failed = true;
      } finally {
        clearTimeout(timer);
        recovery.abort();
      }
    }
    if (failed) throw Error("failed");
    return { ...status, code: "render_pause_ok", value };
  } catch {
    const error = Error("Render backup pause failed");
    error.status = { ...status, pauseAttempted: attempted };
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
