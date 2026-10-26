#!/usr/bin/env node
// Run a command with its full output in a log file; print one line on success, the log tail on failure.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/quiet.mjs COMMAND [ARGS...]");
  process.exit(2);
}
const started = performance.now();
const result = spawnSync(command, args, {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
const log = join(mkdtempSync(join(tmpdir(), "miaou-quiet-")), "output.log");
writeFileSync(log, `${result.stdout ?? ""}${result.stderr ?? ""}`);
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const label = [command, ...args].join(" ");
if (result.status === 0) {
  console.log(`OK ${label} (${seconds}s) — full log: ${log}`);
} else {
  const tail = readFileSync(log, "utf8").trimEnd().split("\n").slice(-40);
  console.log(tail.join("\n"));
  console.log(
    `FAILED ${label} (exit ${result.status ?? result.signal}, ${seconds}s) — full log: ${log}`,
  );
  process.exit(result.status ?? 1);
}
