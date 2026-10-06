import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { createAuth } from "../src/infrastructure/auth/auth.js";
import * as schema from "../src/infrastructure/db/schema.js";
import { accountsHTTP } from "../src/accounts/http.js";
import {
  identity,
  safeReturn,
  signConsent,
  consentCookie,
} from "../src/accounts/security.js";
import { AuthLimits, Limited } from "../src/accounts/limits.js";
import { cleanupAccounts } from "../src/accounts/cleanup.js";
import { operate } from "../src/accounts/operations.js";
const otp = (seed: string) =>
  createOTP(new TextDecoder().decode(base32.decode(seed)));
const resetToken = (url: string) =>
  new URL(url).searchParams.get("token") ??
  new URL(url).pathname.split("/").at(-1)!;
const origin = "http://localhost:43991";
const secret = "isolated-accounts-test-secret-at-least-32-characters";
const databaseURL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test";
if (!new URL(databaseURL).pathname.endsWith("_test"))
  throw new Error("Dedicated test database required");
async function isolated(
  run: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const admin = createDatabase(databaseURL);
  const name = "accounts_" + randomUUID().replaceAll("-", "") + "_test";
  await admin.pool.query(`create database "${name}"`);
  const url = new URL(databaseURL);
  url.pathname = name;
  const h = await setup(url.href);
  try {
    await run(h);
  } finally {
    await closePool(h.pool);
    const remaining = await admin.pool.query(
      "select count(*) from pg_stat_activity where datname=$1",
      [name],
    );
    assert.equal(
      remaining.rows[0].count,
      "0",
      "no connection survives test teardown",
    );
    await admin.pool.query(`drop database "${name}"`);
    await closePool(admin.pool);
  }
}
async function setup(url: string) {
  const { db, pool } = createDatabase(url);
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const sent: { email: string; url: string }[] = [];
  const auth = createAuth(
    db,
    {
      secret,
      baseURL: origin,
      termsVersion: "synthetic-terms-v1",
      sendReset: async (email, url) => {
        sent.push({ email, url });
      },
    },
    schema,
  );
  function client() {
    const jar = new Map<string, string>();
    return {
      headers: () =>
        new Headers({
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        }),
      async call(
        path: string,
        body?: Record<string, unknown>,
        method = body ? "POST" : "GET",
      ) {
        const response = await accountsHTTP(
          new Request(origin + path, {
            method,
            headers: {
              ...Object.fromEntries(this.headers()),
              origin,
              "content-type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
          db,
          auth,
        );
        for (const cookie of response.headers.getSetCookie()) {
          const first = cookie.split(";")[0];
          const at = first.indexOf("=");
          const key = first.slice(0, at);
          const value = first.slice(at + 1);
          if (!value || /Max-Age=0/i.test(cookie)) jar.delete(key);
          else jar.set(key, value);
        }
        return response;
      },
    };
  }
  async function member(email: string) {
    await pool.query(
      "insert into admission (email) values ($1) on conflict do nothing",
      [email],
    );
    const c = client();
    const r = await c.call("/api/auth/sign-up/email", {
      email,
      name: "Synthetic member",
      password: "synthetic-password-long",
      acceptedTerms: true,
    });
    assert.equal(r.status, 200, "authorized signup succeeds");
    const id = (await r.json()).user.id as string;
    return { ...c, id, email };
  }
  return { db, pool, auth, sent, client, member };
}
test("admission and terms: refusal without acceptance, no anonymous ownership, unverified activation", async () =>
  isolated(async (h) => {
    const a = h.client();
    await h.pool.query(
      "insert into admission (email) values ('a@example.test')",
    );
    const input = {
      email: "a@example.test",
      name: "A",
      password: "synthetic-password-long",
    };
    assert.equal((await a.call("/api/auth/sign-up/email", input)).status, 403);
    assert.equal(
      (
        await a.call("/api/auth/sign-up/email", {
          ...input,
          email: "outsider@example.test",
          acceptedTerms: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (await h.pool.query('select count(*) from "user"')).rows[0].count,
      "0",
    );
    const r = await a.call("/api/auth/sign-up/email", {
      ...input,
      acceptedTerms: true,
    });
    assert.equal(r.status, 200);
    assert.equal((await a.call("/api/v1/access")).status, 200);
    const u = (await h.pool.query('select email_verified from "user"')).rows[0];
    assert.equal(u.email_verified, false);
    const policy = (
      await h.pool.query(
        "select accepted_at,terms_version,role from user_policy",
      )
    ).rows[0];
    assert.ok(policy.accepted_at);
    assert.equal(policy.terms_version, "synthetic-terms-v1");
    assert.equal(policy.role, "user");
    const anon = h.client();
    assert.equal((await anon.call("/api/v1/me")).status, 401);
    const malicious = await accountsHTTP(
      new Request(origin + "/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          origin: "https://other.example.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...input, acceptedTerms: true }),
      }),
      h.db,
      h.auth,
    );
    assert.equal(malicious.status, 403);
    assert.equal(
      (
        await a.call("/api/auth/sign-in/social", {
          provider: "google",
          idToken: { token: "synthetic" },
        })
      ).status,
      403,
    );
  }));
test("profiles: ownership, immutable handle, privacy, collision and persistence", async () =>
  isolated(async (h) => {
    const a = await h.member("a@example.test");
    const b = await h.member("b@example.test");
    const payload = {
      handle: "member_a",
      displayName: "A renamed",
      bio: "Synthetic biography",
      color: "sauge",
      avatar: "cat",
    };
    assert.equal(
      (await a.call("/api/v1/me/profile", payload, "PATCH")).status,
      200,
    );
    assert.equal(
      (
        await a.call(
          "/api/v1/me/profile",
          { ...payload, handle: "changed" },
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await b.call(
          "/api/v1/me/profile",
          { ...payload, userId: a.id },
          "PATCH",
        )
      ).status,
      400,
    );
    assert.equal(
      (await b.call("/api/v1/me/profile", payload, "PATCH")).status,
      409,
    );
    const publicProfile = await b.call("/api/v1/profiles/member_a");
    assert.equal(publicProfile.status, 200);
    const p = (await publicProfile.json()).profile;
    assert.equal(p.displayName, "A renamed");
    assert.equal("email" in p, false);
    assert.equal("userId" in p, false);
    assert.equal((await a.call("/api/auth/sign-out", {})).status, 200);
    assert.equal(
      (
        await a.call("/api/auth/sign-in/email", {
          email: a.email,
          password: "synthetic-password-long",
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await a.call("/api/v1/me")).json()).profile.handle,
      "member_a",
    );
  }));
test("withdrawal and suspension preserve personal portal and fresh rights gates", async () =>
  isolated(async (h) => {
    const a = await h.member("a@example.test");
    await operate(h.db, h.auth, "synthetic-operator", "suspend", a.email);
    assert.equal((await a.call("/api/v1/access")).status, 403);
    const me = await a.call("/api/v1/me");
    assert.equal(me.status, 200);
    const data = await me.json();
    assert.equal(data.access, "personal");
    assert.ok(data.reason);
    assert.equal(
      (
        await a.call(
          "/api/v1/me/profile",
          { handle: "aaa", displayName: "A" },
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal((await a.call("/api/v1/me/export", {})).status, 501);
    await operate(h.db, h.auth, "synthetic-operator", "reactivate", a.email);
    assert.equal((await a.call("/api/v1/access")).status, 200);
    await operate(h.db, h.auth, "synthetic-operator", "withdraw", a.email);
    assert.equal((await a.call("/api/v1/access")).status, 403);
    assert.equal((await a.call("/api/v1/me")).status, 200);
    assert.equal((await a.call("/api/auth/sign-out", {})).status, 200);
    assert.equal(
      (
        await a.call("/api/auth/sign-in/email", {
          email: a.email,
          password: "synthetic-password-long",
        })
      ).status,
      200,
    );
    assert.equal((await a.call("/api/v1/access")).status, 403);
  }));
test("password reset: one-time concurrent consumption, expiry, session revocation, no auto login", async () =>
  isolated(async (h) => {
    const a = await h.member("a@example.test");
    const second = h.client();
    await second.call("/api/auth/sign-in/email", {
      email: a.email,
      password: "synthetic-password-long",
    });
    const anon = h.client();
    assert.equal(
      (await anon.call("/api/auth/request-password-reset", { email: a.email }))
        .status,
      200,
    );
    assert.equal(h.sent.length, 1);
    const token = resetToken(h.sent[0].url);
    const results = await Promise.all([
      anon.call("/api/auth/reset-password", {
        token,
        newPassword: "new-synthetic-password-long",
      }),
      anon.call("/api/auth/reset-password", {
        token,
        newPassword: "new-synthetic-password-long",
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await a.call("/api/v1/me")).status, 401);
    assert.equal((await second.call("/api/v1/me")).status, 401);
    assert.equal((await anon.call("/api/v1/me")).status, 401);
    assert.equal(
      (await h.pool.query("select count(*) from session")).rows[0].count,
      "0",
    );
    assert.equal(
      (await h.pool.query("select count(*) from verification")).rows[0].count,
      "0",
    );
    assert.equal(
      (
        await anon.call("/api/auth/sign-in/email", {
          email: a.email,
          password: "synthetic-password-long",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await anon.call("/api/auth/sign-in/email", {
          email: a.email,
          password: "new-synthetic-password-long",
        })
      ).status,
      200,
    );
    await h.pool.query("delete from auth_limit");
    await anon.call("/api/auth/request-password-reset", { email: a.email });
    const expired = resetToken(h.sent.at(-1)!.url);
    await h.pool.query(
      "update verification set expires_at=now()-interval '1 second'",
    );
    assert.equal(
      (
        await anon.call("/api/auth/reset-password", {
          token: expired,
          newPassword: "another-synthetic-password",
        })
      ).status,
      400,
    );
    await h.pool.query("delete from auth_limit");
    const before = h.sent.length;
    assert.equal(
      (
        await anon.call("/api/auth/request-password-reset", {
          email: "absent@example.test",
        })
      ).status,
      200,
    );
    assert.equal(h.sent.length, before);
  }));
test("sessions: absolute and idle boundaries, freshness, cannot reuse another session proof", async () =>
  isolated(async (h) => {
    const a = await h.member("a@example.test");
    const beforeRefresh = (
      await h.pool.query("select authenticated_at from session_security")
    ).rows[0].authenticated_at;
    await h.pool.query("update session set expires_at=now()+interval '3 days'");
    const refreshed = await a.call("/api/v1/me");
    assert.equal(refreshed.status, 200);
    assert.ok(
      refreshed.headers
        .getSetCookie()
        .some((c) => c.startsWith("better-auth.session_token=")),
      "active use returns the renewed native session cookie",
    );
    assert.equal(
      (
        await h.pool.query("select authenticated_at from session_security")
      ).rows[0].authenticated_at.getTime(),
      beforeRefresh.getTime(),
      "cookie refresh never resets the absolute deadline",
    );

    await h.pool.query(
      "update session_security set reauthenticated_at=now()-interval '5 minutes'",
    );
    assert.equal((await a.call("/api/v1/me/export", {})).status, 403);
    assert.equal(
      (await a.call("/api/v1/reauth", { password: "wrong-synthetic-password" }))
        .status,
      403,
    );
    assert.equal(
      (await a.call("/api/v1/reauth", { password: "synthetic-password-long" }))
        .status,
      200,
    );
    assert.equal((await a.call("/api/v1/me/export", {})).status, 501);
    // Use one clock for the exact boundary; the Docker DB clock can differ
    // from Node by milliseconds. Keep the refusal at precisely 30 days.
    const absoluteNow = new Date();
    await h.pool.query("update session_security set authenticated_at=$1", [
      new Date(absoluteNow.getTime() - 30 * 86400000),
    ]);
    assert.equal(await identity(h.db, h.auth, a.headers(), absoluteNow), null);
    assert.equal(
      (await h.pool.query("select count(*) from session")).rows[0].count,
      "0",
    );
    await a.call("/api/auth/sign-in/email", {
      email: a.email,
      password: "synthetic-password-long",
    });
    const idleNow = new Date();
    await h.pool.query("update session_security set used_at=$1", [
      new Date(idleNow.getTime() - 7 * 86400000),
    ]);
    assert.equal((await a.call("/api/v1/me")).status, 401);
    assert.equal(safeReturn("https://outside.example.test"), "/profil");
    assert.equal(safeReturn("//outside.example.test"), "/profil");
    assert.equal(safeReturn("/\\outside.example.test"), "/profil");
    assert.equal(safeReturn("/races?tri=nom"), "/races?tri=nom");
  }));
test("limits: concurrent durable counters, exact boundaries, reset separate from login", async () =>
  isolated(async (h) => {
    const l = new AuthLimits(h.db, secret);
    const now = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        l.reserve(
          "mail:a@example.test",
          [
            [60000, 1],
            [3600000, 3],
            [86400000, 5],
          ],
          now,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const recreated = new AuthLimits(h.db, secret);
    await assert.rejects(
      recreated.reserve("mail:a@example.test", [[60000, 1]], now),
      Limited,
    );
    await recreated.reserve(
      "mail:a@example.test",
      [
        [60000, 1],
        [3600000, 3],
        [86400000, 5],
      ],
      now + 60001,
    );
    for (let n = 0; n < 5; n++)
      await l.loginResult("a@example.test", false, now);
    await assert.rejects(l.loginAllowed("a@example.test", now + 1000), Limited);
    await l.loginAllowed("a@example.test", now + 30001);
    const stored = await h.pool.query(
      "select key::text,events::text from auth_limit",
    );
    assert.equal(JSON.stringify(stored.rows).includes("a@example.test"), false);
  }));
test("admin MFA: credential and OAuth-like ordinary session both require session-owned TOTP proof", async () =>
  isolated(async (h) => {
    const a = await h.member("admin@example.test");
    await operate(h.db, h.auth, "synthetic-operator", "admin", a.email);
    assert.equal((await a.call("/api/v1/admin/access")).status, 403);
    const enabled = await a.call("/api/auth/two-factor/enable", {
      password: "synthetic-password-long",
    });
    assert.equal(enabled.status, 200);
    const setup = await enabled.json();
    const seed = new URL(setup.totpURI).searchParams.get("secret")!;
    const code = await otp(seed).totp();
    assert.equal(
      (await a.call("/api/auth/two-factor/verify-totp", { code: "000000" }))
        .status,
      401,
    );
    assert.equal(
      (await a.call("/api/auth/two-factor/verify-totp", { code })).status,
      200,
    );
    assert.equal((await a.call("/api/v1/admin/access")).status, 200);
    await h.pool.query(
      "update session_security set admin_used_at=now()-interval '15 minutes'",
    );
    assert.equal((await a.call("/api/v1/admin/access")).status, 403);
    assert.equal((await a.call("/api/v1/me")).status, 200);
    await h.pool.query(
      "update session_security set admin_used_at=now(),mfa_at=now()-interval '8 hours'",
    );
    assert.equal((await a.call("/api/v1/admin/access")).status, 403);
    assert.equal(
      (
        await a.call("/api/auth/two-factor/disable", {
          password: "synthetic-password-long",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await a.call("/api/auth/two-factor/verify-totp", {
          code,
          trustDevice: true,
        })
      ).status,
      403,
    );
    // A second ordinary session models the server boundary reached by Google.
    const ctx = await h.auth.$context;
    const native = await ctx.internalAdapter.createSession(a.id);
    assert.ok(native);
    const security = await h.pool.query(
      "select mfa_at from session_security where session_id=$1",
      [native.id],
    );
    assert.equal(security.rows[0].mfa_at, null);
  }));
test("MFA recovery: backup single use, no privileges until new factor, manual proof required", async () =>
  isolated(async (h) => {
    const a = await h.member("admin@example.test");
    await operate(h.db, h.auth, "synthetic-operator", "admin", a.email);
    const setup = await (
      await a.call("/api/auth/two-factor/enable", {
        password: "synthetic-password-long",
      })
    ).json();
    const seed = new URL(setup.totpURI).searchParams.get("secret")!;
    assert.equal(
      (
        await a.call("/api/auth/two-factor/verify-totp", {
          code: await otp(seed).totp(),
        })
      ).status,
      200,
    );
    const backup = setup.backupCodes[0];
    assert.equal(
      (
        await a.call("/api/auth/two-factor/verify-backup-code", {
          code: backup,
        })
      ).status,
      200,
    );
    assert.equal((await a.call("/api/v1/admin/access")).status, 403);
    assert.equal((await a.call("/api/v1/me/export", {})).status, 403);
    assert.notEqual(
      (
        await a.call("/api/auth/two-factor/verify-backup-code", {
          code: backup,
        })
      ).status,
      200,
    );
    const renewed = await a.call("/api/auth/two-factor/enable", {
      password: "synthetic-password-long",
    });
    assert.equal(renewed.status, 200);
    const next = await renewed.json();
    const nextSeed = new URL(next.totpURI).searchParams.get("secret")!;
    assert.equal(
      (
        await a.call("/api/auth/two-factor/verify-totp", {
          code: await otp(nextSeed).totp(),
        })
      ).status,
      200,
    );
    assert.equal((await a.call("/api/v1/admin/access")).status, 200);
    await assert.rejects(
      operate(
        h.db,
        h.auth,
        "synthetic-operator",
        "recover-mfa",
        a.email,
        false,
      ),
    );
    await operate(
      h.db,
      h.auth,
      "synthetic-operator",
      "recover-mfa",
      a.email,
      true,
    );
    assert.equal((await a.call("/api/v1/me")).status, 401);
    const b = h.client();
    assert.equal(
      (
        await b.call("/api/auth/sign-in/email", {
          email: a.email,
          password: "synthetic-password-long",
        })
      ).status,
      200,
    );
    assert.equal((await b.call("/api/v1/admin/access")).status, 403);
    assert.equal((await b.call("/api/v1/me")).status, 200);
    assert.equal(
      (await h.pool.query("select count(*) from security_audit")).rows[0]
        .count === "0",
      false,
    );
  }));
test("manual account recovery keeps identity, suspension and MFA; never automatic notebook transfer", async () =>
  isolated(async (h) => {
    const a = await h.member("a@example.test");
    await operate(h.db, h.auth, "synthetic-operator", "suspend", a.email);
    await assert.rejects(
      operate(
        h.db,
        h.auth,
        "synthetic-operator",
        "recover-account",
        a.email,
        false,
        "replacement@example.test",
      ),
    );
    await operate(
      h.db,
      h.auth,
      "synthetic-operator",
      "recover-account",
      a.email,
      true,
      "replacement@example.test",
    );
    assert.equal((await a.call("/api/v1/me")).status, 401);
    const same = (await h.pool.query('select id,email from "user"')).rows[0];
    assert.equal(same.id, a.id);
    assert.equal(same.email, "replacement@example.test");
    const token = resetToken(h.sent.at(-1)!.url);
    const recovered = h.client();
    assert.equal(
      (
        await recovered.call("/api/auth/reset-password", {
          token,
          newPassword: "recovered-synthetic-password",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await recovered.call("/api/auth/sign-in/email", {
          email: "replacement@example.test",
          password: "recovered-synthetic-password",
        })
      ).status,
      200,
    );
    assert.equal((await recovered.call("/api/v1/access")).status, 403);
    assert.equal((await recovered.call("/api/v1/me")).status, 200);
  }));

test("Google admission and terms enforced before native creation; explicit linking keeps profile", async () =>
  isolated(async (h) => {
    let providerEmail = "google@example.test";
    let providerId = "synthetic-google-id";
    const auth = createAuth(
      h.db,
      {
        secret,
        baseURL: origin,
        termsVersion: "synthetic-terms-v1",
        google: {
          clientId: "synthetic-google-client",
          clientSecret: "synthetic-google-secret",
          verifyIdToken: async (token) => token === "synthetic-google-token",
          getUserInfo: async () => ({
            user: {
              name: "Synthetic Google member",
              email: providerEmail,
              emailVerified: true,
            },
            data: {
              sub: providerId,
              aud: "synthetic-google-client",
              azp: "synthetic-google-client",
              email: providerEmail,
              email_verified: true,
              exp: Math.floor(Date.now() / 1000) + 300,
              iat: Math.floor(Date.now() / 1000),
              iss: "https://accounts.google.com",
              name: "Synthetic Google member",
              given_name: "Synthetic",
              family_name: "Member",
              picture: "",
            },
          }),
        },
      },
      schema,
    );
    const proof = new Headers({
      cookie: `${consentCookie}=${signConsent(secret, "synthetic-terms-v1")}`,
    });
    const login = (headers?: Headers) =>
      auth.api.signInSocial({
        headers,
        body: {
          provider: "google",
          idToken: { token: "synthetic-google-token" },
        },
        asResponse: true,
      });
    await h.pool.query("insert into admission (email) values ($1)", [
      providerEmail,
    ]);
    assert.equal((await login()).status, 403);
    assert.equal(
      (await h.pool.query('select count(*) from "user"')).rows[0].count,
      "0",
    );
    providerEmail = "not-admitted@example.test";
    assert.equal((await login(proof)).status, 403);
    providerEmail = "google@example.test";
    const result = await login(proof);
    assert.equal(result.status, 200);
    const cookies = new Headers({
      cookie: result.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    assert.equal(
      (
        await accountsHTTP(
          new Request(origin + "/api/v1/access", { headers: cookies }),
          h.db,
          auth,
        )
      ).status,
      200,
    );
    const googleId = (
      await h.pool.query('select id from "user" where email=$1', [
        providerEmail,
      ])
    ).rows[0].id;
    await h.pool.query(
      "insert into verification (id,identifier,value,expires_at) values ($1,$2,$3,now()+interval '30 minutes')",
      [randomUUID(), "reset-password:synthetic-link", googleId],
    );
    await assert.rejects(
      auth.api.resetPassword({
        body: {
          token: "synthetic-link",
          newPassword: "synthetic-new-password-long",
        },
        asResponse: true,
      }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
    await h.pool.query(
      "update session_security set reauthenticated_at=now()-interval '5 minutes'",
    );
    await assert.rejects(
      auth.api.resetPassword({
        headers: cookies,
        body: {
          token: "synthetic-link",
          newPassword: "synthetic-new-password-long",
        },
        asResponse: true,
      }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
    await h.pool.query("update session_security set reauthenticated_at=now()");
    assert.equal(
      (
        await auth.api.resetPassword({
          headers: cookies,
          body: {
            token: "synthetic-link",
            newPassword: "synthetic-new-password-long",
          },
          asResponse: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.pool.query("select count(*) from profile where user_id=$1", [
          googleId,
        ])
      ).rows[0].count,
      "1",
    );
    const existing = await h.member("email@example.test");
    providerEmail = existing.email;
    providerId = "second-synthetic-google-id";
    assert.equal((await login(proof)).status, 401);
    assert.equal(
      (
        await h.pool.query("select count(*) from profile where user_id=$1", [
          existing.id,
        ])
      ).rows[0].count,
      "1",
    );
    const linked = await auth.api.linkSocialAccount({
      headers: existing.headers(),
      body: {
        provider: "google",
        idToken: { token: "synthetic-google-token" },
      },
      asResponse: true,
    });
    assert.equal(linked.status, 200);
    const methods = await h.pool.query(
      "select provider_id from account where user_id=$1",
      [existing.id],
    );
    assert.deepEqual(methods.rows.map((x) => x.provider_id).sort(), [
      "credential",
      "google",
    ]);
    await h.pool.query(
      "update session_security set reauthenticated_at=now()-interval '5 minutes'",
    );
    await assert.rejects(
      auth.api.linkSocialAccount({
        headers: existing.headers(),
        body: {
          provider: "google",
          idToken: { token: "synthetic-google-token" },
        },
        asResponse: true,
      }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
    providerEmail = "google-admin@example.test";
    providerId = "synthetic-google-admin-id";
    await h.pool.query("insert into admission (email) values ($1)", [
      providerEmail,
    ]);
    const adminLogin = await login(proof);
    assert.equal(adminLogin.status, 200);
    let adminHeaders = new Headers({
      cookie: adminLogin.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    await h.pool.query(
      "update user_policy set role='admin' where user_id=(select id from \"user\" where email=$1)",
      [providerEmail],
    );
    const adminAccess = () =>
      accountsHTTP(
        new Request(origin + "/api/v1/admin/access", { headers: adminHeaders }),
        h.db,
        auth,
      );
    assert.equal((await adminAccess()).status, 403);
    const enabled = await auth.api.enableTwoFactor({
      headers: adminHeaders,
      body: {},
      asResponse: true,
    });
    assert.equal(
      enabled.status,
      200,
      "Google-only admin can enroll without a password",
    );
    const setup = await enabled.json();
    const code = await otp(
      new URL(setup.totpURI).searchParams.get("secret")!,
    ).totp();
    const verified = await auth.api.verifyTOTP({
      headers: adminHeaders,
      body: { code },
      asResponse: true,
    });
    assert.equal(verified.status, 200);
    adminHeaders = new Headers({
      cookie: verified.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    assert.equal((await adminAccess()).status, 200);
    const newLogin = await login(proof);
    assert.equal(newLogin.status, 200);
    adminHeaders = new Headers({
      cookie: newLogin.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    assert.equal(
      (await adminAccess()).status,
      403,
      "another native Google session cannot reuse MFA proof",
    );
  }));

test("cleanup removes expired secrets, limits and aged logs while keeping live records", async () =>
  isolated(async (h) => {
    const member = await h.member("retention@example.test");
    await h.pool.query(
      "insert into verification (id,identifier,value,expires_at) values ($1,'expired-reset','synthetic',now()-interval '1 second'),($2,'live-reset','synthetic',now()+interval '1 day')",
      [randomUUID(), randomUUID()],
    );
    await h.pool.query(
      "insert into auth_limit (key,expires_at) values ('expired',now()-interval '1 second'),('live',now()+interval '1 day')",
    );
    await h.pool.query(
      "insert into mail_attempt (id,recipient,type,result,created_at) values ($1,'synthetic@example.test','password_reset','accepted',now()-interval '31 days'),($2,'synthetic@example.test','password_reset','failed',now())",
      [randomUUID(), randomUUID()],
    );
    await h.pool.query(
      "insert into security_audit (id,actor,target,action,created_at) values ($1,'operator','synthetic','test',now()-interval '7 months'),($2,'operator','synthetic','test',now())",
      [randomUUID(), randomUUID()],
    );
    await cleanupAccounts(h.db);
    for (const table of [
      "verification",
      "auth_limit",
      "mail_attempt",
      "security_audit",
    ])
      assert.equal(
        (await h.pool.query(`select count(*) from ${table}`)).rows[0].count,
        "1",
      );
    assert.equal((await member.call("/api/v1/access")).status, 200);
  }));
