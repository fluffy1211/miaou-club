import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDatabase } from "../server/src/infrastructure/db/client.js";
import * as schema from "../server/src/infrastructure/db/schema.js";
const url = new URL(
  process.env.TEST_DATABASE_URL ??
    "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test",
);
if (!url.pathname.endsWith("_test"))
  throw new Error("E2E requires a dedicated test DB");
const admin = createDatabase(url.href);
const name = `e2e_${randomUUID().replaceAll("-", "")}_test`;
await admin.pool.query(`create database "${name}"`);
url.pathname = name;
const { db, pool } = createDatabase(url.href);
const secret = randomUUID() + randomUUID();
try {
  await migrate(db, { migrationsFolder: "server/drizzle" });
  const auth = betterAuth({
    secret,
    baseURL: "http://localhost:43991",
    logger: { disabled: true },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
  });
  const cookies: Record<string, string> = {};
  for (const [role, admitted, status] of [
    ["member", true, "active"],
    ["unadmitted", false, "active"],
    ["suspended", true, "suspended"],
  ] as const) {
    const result = await auth.api.signUpEmail({
      body: {
        name: "Synthetic fixture",
        email: `${role}@example.test`,
        password: "synthetic-fixture-password-long",
      },
      asResponse: true,
    });
    if (result.status !== 200) throw new Error("Fixture creation failed");
    const body = await result.json();
    await pool.query('update "user" set email_verified=true where id=$1', [
      body.user.id,
    ]);
    await pool.query(
      "insert into user_policy (user_id,admitted,status) values ($1,$2,$3)",
      [body.user.id, admitted, status],
    );
    cookies[role] = result.headers.get("set-cookie")!.split(";")[0];
  }
  await writeFile(
    "dist/client/_astro/e2e-fixture.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#bcdccb"/></svg>',
  );
  await mkdir(".cache", { recursive: true });
  await writeFile(".cache/e2e-sessions.json", JSON.stringify(cookies), {
    mode: 0o600,
  });
  await pool.end();
  const child = spawn(process.execPath, ["server/start.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "43991",
      DATABASE_URL: url.href,
      BETTER_AUTH_URL: "http://localhost:43991",
      BETTER_AUTH_SECRET: secret,
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  const [code, signal] = await once(child, "exit");
  console.log(JSON.stringify({ component: "e2e-server", code, signal }));
  process.exitCode = code ?? 0;
} finally {
  if (!pool.ended) await pool.end();
  await admin.pool.query(`drop database "${name}" with (force)`);
  await admin.pool.end();
  await rm("dist/client/_astro/e2e-fixture.svg", { force: true });
  await rm(".cache/e2e-sessions.json", { force: true });
}
