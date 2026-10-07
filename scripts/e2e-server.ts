import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  createDatabase,
  closePool,
} from "../server/src/infrastructure/db/client.js";
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
    ["reader", true, "active"],
    ["friend-a-chromium-mobile", true, "active"],
    ["friend-b-chromium-mobile", true, "active"],
    ["friend-a-webkit-mobile", true, "active"],
    ["friend-b-webkit-mobile", true, "active"],
    ["admin", true, "active"],
    ["data-chromium-mobile", true, "active"],
    ["data-webkit-mobile", true, "active"],
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
      "insert into user_policy (user_id,admitted,status,accepted_at,terms_version) values ($1,$2,$3,now(),'synthetic-terms-v1')",
      [body.user.id, admitted, status],
    );
    await pool.query("insert into admission (email,active) values ($1,$2)", [
      `${role}@example.test`,
      admitted,
    ]);
    await pool.query(
      "insert into profile (user_id,display_name) values ($1,$2)",
      [body.user.id, "Synthetic fixture"],
    );
    if (role.startsWith("friend-"))
      await pool.query(
        "update profile set handle=$1,display_name=$2 where user_id=$3",
        [
          role.replaceAll("-", "_"),
          role.includes("-a-") ? "Camille synthétique" : "Lou synthétique",
          body.user.id,
        ],
      );
    if (role === "reader")
      await pool.query(
        "update profile set handle='synthetic_reader',color='corail',avatar='cat',bio='Profil synthétique du club.' where user_id=$1",
        [body.user.id],
      );
    await pool.query(
      "insert into session_security (session_id,authenticated_at,used_at,reauthenticated_at) select id,now(),now(),now() from session where user_id=$1",
      [body.user.id],
    );
    if (role === "admin") {
      await pool.query("update user_policy set role='admin' where user_id=$1", [
        body.user.id,
      ]);
      await pool.query(
        'update "user" set two_factor_enabled=true where id=$1',
        [body.user.id],
      );
      await pool.query(
        "update session_security set mfa_at=now(),admin_used_at=now() where session_id in(select id from session where user_id=$1)",
        [body.user.id],
      );
    }
    cookies[role] = result.headers.get("set-cookie")!.split(";")[0];
  }
  await pool.query(
    "insert into admission (email) values ('new-chromium-mobile@example.test'),('new-webkit-mobile@example.test')",
  );
  await writeFile(
    "dist/client/_astro/e2e-fixture.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#bcdccb"/></svg>',
  );
  await mkdir(".cache", { recursive: true });
  await mkdir(`.cache/${name}-media`, { recursive: true, mode: 0o700 });
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#bcdccb"/><path d="M180 280L160 80L270 150L380 150L480 80L460 280Q450 410 320 410Q190 410 180 280" fill="#49366d"/><ellipse cx="260" cy="250" rx="30" ry="35" fill="#f4d978"/><ellipse cx="380" cy="250" rx="30" ry="35" fill="#f4d978"/><path d="M300 310L340 310L320 335Z" fill="#f47c67"/></svg>`,
    ),
  )
    .png()
    .toFile(".cache/e2e-photo.png");
  await writeFile(".cache/e2e-sessions.json", JSON.stringify(cookies), {
    mode: 0o600,
  });
  await closePool(pool);
  const child = spawn(process.execPath, ["server/start.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      MIAOU_LOCAL_MEDIA_DIR: `${process.cwd()}/.cache/${name}-media`,
      MIAOU_TERMS_VERSION: "synthetic-terms-v1",
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
  if (!pool.ended) await closePool(pool);
  await admin.pool.query(`drop database "${name}" with (force)`);
  await closePool(admin.pool);
  await rm("dist/client/_astro/e2e-fixture.svg", { force: true });
  await rm(".cache/e2e-sessions.json", { force: true });
  await rm(".cache/e2e-photo.png", { force: true });
  await rm(`.cache/${name}-media`, { recursive: true, force: true });
}
