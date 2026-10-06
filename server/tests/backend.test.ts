import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { Layer } from "effect";
import { HttpApp } from "@effect/platform";
import { createDatabase, closePool } from "../src/infrastructure/db/client.js";
import { createAuth } from "../src/infrastructure/auth/auth.js";
import * as schema from "../src/infrastructure/db/schema.js";
import { app, Services } from "../src/http/app.js";

const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test";
const parsed = new URL(url);
if (!parsed.pathname.endsWith("_test"))
  throw new Error("Tests require a dedicated *_test database");
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const baseURL = "http://localhost:4321";
const secret = "isolated-test-only-auth-secret-at-least-32-characters";

// Each test gets a dedicated PostgreSQL database; generated SQL is unmodified.
async function isolated(
  run: (services: ReturnType<typeof createDatabase>) => Promise<void>,
) {
  const name = `isolated_${randomUUID().replaceAll("-", "")}_test`;
  const admin = createDatabase(url);
  await admin.pool.query(`create database "${name}"`);
  const scoped = new URL(url);
  scoped.pathname = name;
  const services = createDatabase(scoped.href);
  try {
    await run(services);
  } finally {
    if (!services.pool.ended) await closePool(services.pool);
    await admin.pool.query(`drop database "${name}" with (force)`);
    await closePool(admin.pool);
  }
}
async function apply(
  pool: ReturnType<typeof createDatabase>["pool"],
  folder = migrationsFolder,
) {
  await migrate(drizzle(pool), { migrationsFolder: folder });
}

test("migrations: empty DB, auth fixture, additive policy migration, repeat, constraints", async () =>
  isolated(async ({ pool }) => {
    const first = await mkdtemp(join(tmpdir(), "miaou-migration-"));
    try {
      await cp(migrationsFolder, first, { recursive: true });
      const journalPath = join(first, "meta/_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.entries = journal.entries.slice(0, 1);
      await writeFile(journalPath, JSON.stringify(journal));
      await apply(pool, first);
      await pool.query('insert into "user" (id,name,email) values ($1,$2,$3)', [
        "migration-fixture",
        "Fixture",
        "fixture@example.test",
      ]);
      await apply(pool);
      await apply(pool);
      assert.equal(
        (await pool.query('select count(*) from "user"')).rows[0].count,
        "1",
      );
      assert.equal(
        (await pool.query('select count(*) from "user_policy"')).rows[0].count,
        "0",
      );
      await assert.rejects(
        pool.query("insert into user_policy (user_id) values ('unknown')"),
        { code: "23503" },
      );
      await assert.rejects(
        pool.query(
          "insert into user_policy (user_id,status) values ('migration-fixture','admin')",
        ),
        { code: "23514" },
      );
      await pool.query(
        "insert into user_policy (user_id) values ('migration-fixture')",
      );
      assert.equal(
        (await pool.query("select admitted from user_policy")).rows[0].admitted,
        false,
      );
      await assert.rejects(
        pool.query(
          "insert into user_policy (user_id) values ('migration-fixture')",
        ),
        { code: "23505" },
      );
      await pool.query('delete from "user" where id = $1', [
        "migration-fixture",
      ]);
      assert.equal(
        (await pool.query("select count(*) from user_policy")).rows[0].count,
        "0",
      );
    } finally {
      await rm(first, { recursive: true });
    }
  }));

test("real Better Auth cookie: refusal, verified session, admission, suspension, withdrawal and revocation", async () =>
  isolated(async ({ db, pool }) => {
    await apply(pool);
    // Fixture creation only; the application uses createAuth with signup disabled.
    const fixtures = betterAuth({
      secret,
      baseURL,
      database: drizzleAdapter(db, { provider: "pg", schema }),
      emailAndPassword: { enabled: true },
    });
    const account = await fixtures.api.signUpEmail({
      body: {
        name: "Test member",
        email: "member@example.test",
        password: "fixture-password-long",
      },
    });
    await pool.query('update "user" set email_verified = true where id = $1', [
      account.user.id,
    ]);
    const auth = createAuth(db, { secret, baseURL }, schema);
    const runtime = HttpApp.toWebHandlerLayer(
      app,
      Layer.succeed(Services, { db, pool, auth }),
    );
    const request = (path: string, cookie?: string) =>
      runtime.handler(
        new Request(baseURL + path, { headers: cookie ? { cookie } : {} }),
      );
    try {
      assert.equal((await request("/api/health")).status, 200);
      assert.equal((await request("/api/ready")).status, 200);
      assert.equal((await request("/api/v1/access")).status, 401);
      const login = await auth.handler(
        new Request(baseURL + "/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseURL },
          body: JSON.stringify({
            email: "member@example.test",
            password: "fixture-password-long",
          }),
        }),
      );
      assert.equal(login.status, 200);
      const setCookie = login.headers.get("set-cookie")!;
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      const cookie = setCookie.split(";")[0];
      assert.equal((await request("/api/v1/access", cookie)).status, 403);
      await pool.query(
        "insert into user_policy (user_id, admitted,accepted_at,terms_version) values ($1,true,now(),'synthetic-terms-v1')",
        [account.user.id],
      );
      await pool.query(
        "insert into admission (email) values ('member@example.test')",
      );
      let response = await request("/api/v1/access", cookie);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { status: "authorized" });
      for (const status of ["suspended", "withdrawn", "deleting"]) {
        await pool.query("update user_policy set status=$1", [status]);
        assert.equal((await request("/api/v1/access", cookie)).status, 403);
      }
      await pool.query("update user_policy set status='active',admitted=false");
      assert.equal((await request("/api/v1/access", cookie)).status, 403);
      await pool.query("update user_policy set admitted=true");
      await pool.query('update "user" set email_verified=false');
      // Gabriel removed email-verification as an access/publication prerequisite.
      assert.equal((await request("/api/v1/access", cookie)).status, 200);
      await pool.query('update "user" set email_verified=true');
      await auth.api.signOut({ headers: new Headers({ cookie }) });
      assert.equal((await request("/api/v1/access", cookie)).status, 401);
      response = await runtime.handler(
        new Request(baseURL + "/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseURL },
          body: JSON.stringify({
            email: "other@example.test",
            password: "another-long-password",
            name: "Other",
          }),
        }),
      );
      assert.equal(response.status, 403);
      assert.equal(
        (await pool.query('select count(*) from "user"')).rows[0].count,
        "1",
      );
      const malicious = await auth.handler(
        new Request(baseURL + "/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://untrusted.example.test",
          },
          body: JSON.stringify({
            email: "member@example.test",
            password: "fixture-password-long",
          }),
        }),
      );
      assert.equal(malicious.status, 403);
    } finally {
      await runtime.dispose();
    }
  }));

test("Google provider with deterministic double: native auth session, no auto-link, signup closed", async () =>
  isolated(async ({ db, pool }) => {
    await apply(pool);
    // Provider substitution only in this test process, no fake login endpoint.
    let providerEmail = "collision@example.test";
    const auth = betterAuth({
      secret,
      baseURL,
      logger: { disabled: true },
      emailAndPassword: { enabled: true },
      database: drizzleAdapter(db, { provider: "pg", schema }),
      account: { accountLinking: { enabled: false } },
      socialProviders: {
        google: {
          clientId: "fixture-google-client",
          clientSecret: "fixture-google-secret",
          verifyIdToken: async (token) => token === "fixture-token",
          getUserInfo: async () => ({
            user: {
              name: "Google fixture",
              email: providerEmail,
              emailVerified: true,
            },
            data: {
              sub: "google-fixture-id",
              aud: "fixture-google-client",
              azp: "fixture-google-client",
              email: providerEmail,
              email_verified: true,
              name: "Google fixture",
              given_name: "Google",
              family_name: "Fixture",
              picture: "",
              iss: "https://accounts.google.com",
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 300,
            },
          }),
        },
      },
    });
    await auth.api.signUpEmail({
      body: {
        email: providerEmail,
        name: "Credential fixture",
        password: "synthetic-collision-password",
      },
    });
    const collision = await auth.api.signInSocial({
      body: { provider: "google", idToken: { token: "fixture-token" } },
      asResponse: true,
    });
    assert.equal(collision.status, 401);
    assert.equal(
      (
        await pool.query(
          "select count(*) from account where provider_id='google'",
        )
      ).rows[0].count,
      "0",
    );
    providerEmail = "google@example.test";
    const result = await auth.api.signInSocial({
      body: { provider: "google", idToken: { token: "fixture-token" } },
      asResponse: true,
    });
    assert.equal(result.status, 200);
    const cookie = result.headers.get("set-cookie")!.split(";")[0];
    assert.ok(await auth.api.getSession({ headers: new Headers({ cookie }) }));
    assert.equal(
      (
        await pool.query(
          "select provider_id from account where provider_id='google'",
        )
      ).rows[0].provider_id,
      "google",
    );
    await assert.rejects(
      auth.api.signInSocial({
        body: { provider: "google", idToken: { token: "bad-token" } },
      }),
    );
    const configured = createAuth(
      db,
      {
        secret,
        baseURL,
        google: {
          clientId: "fixture-google-client",
          clientSecret: "fixture-google-secret",
        },
      },
      schema,
    );
    assert.equal(
      configured.options.socialProviders.google?.disableSignUp,
      true,
    );
    assert.equal(
      configured.options.account?.accountLinking?.disableImplicitLinking,
      true,
    );
  }));

test("database failure is a bounded 503 without driver details", async () =>
  isolated(async ({ db, pool }) => {
    const auth = createAuth(db, { secret, baseURL }, schema);
    const runtime = HttpApp.toWebHandlerLayer(
      app,
      Layer.succeed(Services, { db, pool, auth }),
    );
    await closePool(pool);
    try {
      const response = await runtime.handler(
        new Request(baseURL + "/api/ready"),
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { code: "unavailable" });
    } finally {
      await runtime.dispose();
    }
  }));
