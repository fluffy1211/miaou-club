import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validatePreproductionEnv } from "../scripts/preproduction-config.mjs";

const script = join(process.cwd(), "scripts/preproduction-config.mjs");
const valid = `NODE_ENV=production
HOST=0.0.0.0
PORT=4321
BETTER_AUTH_URL=https://auth.example.invalid
BETTER_AUTH_SECRET=${"s".repeat(32)}
DATABASE_URL=postgresql://user:pass@db.example.invalid/miaou?sslmode=verify-full
MIAOU_STORAGE_URL=https://storage.example.invalid
MIAOU_STORAGE_SECRET=synthetic-secret
MIAOU_STORAGE_BUCKET=private-photos
PUBLIC_MIAOU_MAPTILER_APPROVED=0
`;

function run(args: string[], env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env,
  });
}

function parsed(result: ReturnType<typeof run>) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("valid synthetic explicit file passes and does not rely on ambient env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-preproduction-"));
  const file = join(dir, "candidate.env");
  try {
    await writeFile(file, valid);
    const result = run(["--preproduction-env-file", file], {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: undefined,
    });
    assert.equal(result.status, 0);
    assert.deepEqual(parsed(result), { ok: true, errors: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects invalid fields and emits field codes without secret values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-preproduction-"));
  const file = join(dir, "candidate.env");
  const sentinel = "PRIVATE_SENTINEL_SHOULD_NEVER_LEAK";
  try {
    await writeFile(
      file,
      valid.replace("sslmode=verify-full", "sslmode=disable") +
        `BETTER_AUTH_SECRET=${sentinel}\nPUBLIC_MIAOU_MAPTILER_KEY=${sentinel}\n`,
    );
    const result = run(["--preproduction-env-file", file]);
    assert.equal(result.status, 1);
    const output = parsed(result);
    assert.deepEqual(output.errors, [
      "DATABASE_URL",
      "PUBLIC_MIAOU_MAPTILER_KEY",
    ]);
    assert.equal(result.stdout.includes(sentinel), false);
    assert.equal(result.stdout.includes(file), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("requires an explicit file and rejects unknown arguments without exposing paths", async () => {
  const absent = run([]);
  assert.equal(absent.status, 1);
  assert.deepEqual(parsed(absent), { ok: false, errors: ["CLI_ARGUMENTS"] });
  const unknown = run([
    "--preproduction-env-file",
    "/private/sensitive/location",
    "--verbose",
  ]);
  assert.equal(unknown.status, 1);
  assert.deepEqual(parsed(unknown), { ok: false, errors: ["CLI_ARGUMENTS"] });
  assert.equal(unknown.stdout.includes("/private/sensitive/location"), false);
});

test("committed template remains safely incomplete", async () => {
  const template = await readFile(
    join(process.cwd(), "deploy/preproduction.env.example"),
    "utf8",
  );
  const dir = await mkdtemp(join(tmpdir(), "miaou-preproduction-"));
  const file = join(dir, "template.env");
  try {
    await writeFile(file, template);
    const result = run(["--preproduction-env-file", file]);
    assert.equal(result.status, 1);
    const errors = parsed(result).errors as string[];
    assert.ok(errors.includes("BETTER_AUTH_SECRET"));
    assert.ok(errors.includes("MIAOU_STORAGE"));
    assert.ok(errors.includes("DATABASE_URL"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("enforces origin, authenticated TLS database, closed pilot and disabled providers", () => {
  const base = Object.fromEntries(
    valid
      .trim()
      .split("\n")
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  const cases = [
    [
      { BETTER_AUTH_URL: "https://user@auth.example.invalid" },
      "BETTER_AUTH_URL",
    ],
    [
      { BETTER_AUTH_URL: "https://auth.example.invalid/a/.." },
      "BETTER_AUTH_URL",
    ],
    [{ BETTER_AUTH_SECRET: "short" }, "BETTER_AUTH_SECRET"],
    [
      {
        DATABASE_URL:
          "postgresql://user:pass@db.example.invalid/miaou?sslmode=constructor",
      },
      "DATABASE_URL",
    ],
    [
      {
        DATABASE_URL:
          "postgresql://user:pass@db.example.invalid/miaou?sslmode=require&sslmode=disable",
      },
      "DATABASE_URL",
    ],
    [
      {
        DATABASE_URL:
          "postgresql://user:pass@db.example.invalid/miaou?sslmode=require&ssl=false",
      },
      "DATABASE_URL",
    ],
    [
      { MIAOU_STORAGE_URL: "http://storage.example.invalid" },
      "MIAOU_STORAGE_URL",
    ],
    [{ MIAOU_STORAGE_BUCKET: "bad_bucket" }, "MIAOU_STORAGE_BUCKET"],
    [{ MIAOU_STORAGE_SECRET: "" }, "MIAOU_STORAGE"],
    [{ MIAOU_LOCAL_MEDIA_DIR: "/tmp/media" }, "MIAOU_LOCAL_MEDIA_DIR"],
    [{ MIAOU_TERMS_VERSION: "terms-v1" }, "MIAOU_TERMS_VERSION"],
    [{ GOOGLE_CLIENT_ID: "configured" }, "GOOGLE_CLIENT_ID"],
    [{ RESEND_API_KEY: "configured" }, "RESEND_API_KEY"],
    [{ PUBLIC_MIAOU_MAPTILER_APPROVED: "1" }, "PUBLIC_MIAOU_MAPTILER_APPROVED"],
    [{ PUBLIC_MIAOU_MAPTILER_KEY: "configured" }, "PUBLIC_MIAOU_MAPTILER_KEY"],
    [{ NODE_TLS_REJECT_UNAUTHORIZED: "0" }, "UNKNOWN_FIELDS"],
    [{ PGSSLMODE: "disable" }, "UNKNOWN_FIELDS"],
    [{ NODE_OPTIONS: "--require=/tmp/injected.cjs" }, "UNKNOWN_FIELDS"],
  ] as const;
  for (const [overrides, expected] of cases) {
    assert.ok(
      validatePreproductionEnv({ ...base, ...overrides }).includes(expected),
      `expected ${expected} for invalid synthetic configuration`,
    );
  }
});

test("missing explicit file fails with a path-free JSON field code", () => {
  const missingPath = "/private/sensitive/missing-preproduction.env";
  const ambient = Object.fromEntries(
    valid
      .trim()
      .split("\n")
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  const result = run(["--preproduction-env-file", missingPath], {
    ...process.env,
    ...ambient,
  });
  assert.equal(result.status, 1);
  assert.deepEqual(parsed(result), { ok: false, errors: ["ENV_FILE"] });
  assert.equal(result.stdout.includes(missingPath), false);
});
