import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../dist/backend/infrastructure/db/client.js";
const testURL = new URL(
  process.env.TEST_DATABASE_URL ??
    "postgresql://miaou_test:local-test-only@127.0.0.1:54330/miaou_test",
);
if (!testURL.pathname.endsWith("_test"))
  throw new Error("Image smoke test requires a dedicated test DB");
const name = `smoke_${randomUUID().replaceAll("-", "")}_test`;
const container = `miaou-smoke-${randomUUID()}`;
const admin = createDatabase(testURL.href);
const target = new URL(testURL);
target.pathname = name;
let database;
try {
  await admin.pool.query(`create database "${name}"`);
  database = createDatabase(target.href);
  await migrate(database.db, { migrationsFolder: "dist/drizzle" });
  const dockerURL = new URL(target);
  if (["localhost", "127.0.0.1"].includes(dockerURL.hostname))
    dockerURL.hostname = "host.docker.internal";
  const run = (args) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  run([
    "run",
    "-d",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    "127.0.0.1::4321",
    "-e",
    `DATABASE_URL=${dockerURL.href}`,
    "-e",
    `BETTER_AUTH_SECRET=${randomUUID()}${randomUUID()}`,
    "-e",
    "BETTER_AUTH_URL=https://localhost",
    process.env.MIAOU_IMAGE ?? "miaou-lot1:local",
  ]);
  const port = run(["port", container, "4321/tcp"]).trim().split(":").at(-1);
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      if ((await fetch(origin + "/api/health")).status === 200) break;
    } catch {
      /* startup in progress */
    }
    if (Date.now() >= deadline) throw new Error("Image did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const [path, expected] of [
    ["/api/ready", 200],
    ["/api/v1/access", 401],
    ["/_image?href=synthetic", 401],
    ["/_astro/synthetic.%73vg", 401],
  ]) {
    const response = await fetch(origin + path);
    if (response.status !== expected)
      throw new Error(
        `Image response mismatch for ${path}: ${response.status}`,
      );
    if (response.headers.get("cache-control") !== "no-store")
      throw new Error("Missing no-store");
  }
  const page = await fetch(origin + "/races", { redirect: "manual" });
  if (page.status !== 302 || page.headers.get("location") !== "/acces")
    throw new Error("Catalogue guard failed in image");
  const notice = await fetch(origin + "/acces");
  if (
    notice.status !== 200 ||
    !(await notice.text()).includes(
      "Les inscriptions ne sont pas encore ouvertes.",
    )
  )
    throw new Error("Astro/React notice failed in image");
  console.log(
    "Docker runtime: health, PostgreSQL readiness, page rendering and access refusals passed",
  );
} finally {
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  } catch {
    /* container never started */
  }
  if (database) await database.pool.end();
  await admin.pool.query(`drop database if exists "${name}" with (force)`);
  await admin.pool.end();
}
