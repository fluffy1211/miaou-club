#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { createClientIPResolver } from "../server/client-ip.mjs";

const bucketPattern = /^[a-z0-9-]+$/;
const allowedFields = new Set([
  "NODE_ENV",
  "HOST",
  "PORT",
  "MIAOU_TRUSTED_PROXY_CIDRS",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "MIAOU_STORAGE_URL",
  "MIAOU_STORAGE_SECRET",
  "MIAOU_STORAGE_BUCKET",
  "MIAOU_LOCAL_MEDIA_DIR",
  "MIAOU_TERMS_VERSION",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "MIAOU_MAIL_FROM",
  "PUBLIC_MIAOU_MAPTILER_APPROVED",
  "PUBLIC_MIAOU_MAPTILER_KEY",
]);

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return (
      /^https:\/\/[^/?#]+\/?$/i.test(value) &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function validDatabase(value) {
  try {
    const url = new URL(value);
    const sslModes = url.searchParams.getAll("sslmode");
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.username.length > 0 &&
      url.password.length > 0 &&
      url.pathname.length > 1 &&
      [...url.searchParams.keys()].every((key) => key === "sslmode") &&
      sslModes.length === 1 &&
      ["require", "verify-full"].includes(sslModes[0].toLowerCase())
    );
  } catch {
    return false;
  }
}

export function validatePreproductionEnv(env) {
  const errors = [];
  const check = (condition, code) => {
    if (!condition) errors.push(code);
  };

  check(
    Object.keys(env).every((key) => allowedFields.has(key)),
    "UNKNOWN_FIELDS",
  );
  try {
    createClientIPResolver(env.MIAOU_TRUSTED_PROXY_CIDRS ?? "");
  } catch {
    errors.push("MIAOU_TRUSTED_PROXY_CIDRS");
  }
  check(env.NODE_ENV === "production", "NODE_ENV");
  check(env.HOST === "0.0.0.0", "HOST");
  check(env.PORT === "4321", "PORT");
  check(isHttpsOrigin(env.BETTER_AUTH_URL ?? ""), "BETTER_AUTH_URL");
  check((env.BETTER_AUTH_SECRET ?? "").length >= 32, "BETTER_AUTH_SECRET");
  check(validDatabase(env.DATABASE_URL ?? ""), "DATABASE_URL");

  const storage = [
    env.MIAOU_STORAGE_URL,
    env.MIAOU_STORAGE_SECRET,
    env.MIAOU_STORAGE_BUCKET,
  ];
  check(
    storage.every((value) => typeof value === "string" && value.length > 0),
    "MIAOU_STORAGE",
  );
  check(isHttpsOrigin(env.MIAOU_STORAGE_URL ?? ""), "MIAOU_STORAGE_URL");
  check(
    typeof env.MIAOU_STORAGE_BUCKET === "string" &&
      bucketPattern.test(env.MIAOU_STORAGE_BUCKET),
    "MIAOU_STORAGE_BUCKET",
  );

  check(!env.MIAOU_LOCAL_MEDIA_DIR, "MIAOU_LOCAL_MEDIA_DIR");
  check(!env.MIAOU_TERMS_VERSION, "MIAOU_TERMS_VERSION");
  for (const key of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
    "MIAOU_MAIL_FROM",
  ]) {
    check(!env[key], key);
  }
  check(
    !env.PUBLIC_MIAOU_MAPTILER_APPROVED ||
      env.PUBLIC_MIAOU_MAPTILER_APPROVED === "0",
    "PUBLIC_MIAOU_MAPTILER_APPROVED",
  );
  check(!env.PUBLIC_MIAOU_MAPTILER_KEY, "PUBLIC_MIAOU_MAPTILER_KEY");
  return errors;
}

function emit(errors) {
  process.stdout.write(
    `${JSON.stringify({ ok: errors.length === 0, errors })}\n`,
  );
  process.exitCode = errors.length === 0 ? 0 : 1;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--preproduction-env-file" || !args[1]) {
    emit(["CLI_ARGUMENTS"]);
    return;
  }
  try {
    const contents = await readFile(args[1], "utf8");
    emit(validatePreproductionEnv(parseEnv(contents)));
  } catch {
    emit(["ENV_FILE"]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
