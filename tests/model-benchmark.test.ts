import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const script = resolve(root, "scripts/model-benchmark.mjs");
const archive = resolve(root, "docs/benchmarks/model-routing-2026-10-11.jsonl");
const archivedRows = (await readFile(archive, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

async function withReplay(
  input: string,
  run: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "miaou-model-replay-test-"));
  try {
    await writeFile(join(directory, "input.jsonl"), input);
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function replay(directory: string, tasks: string) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--replay",
      join(directory, "input.jsonl"),
      "--tasks",
      tasks,
      "--output",
      join(directory, "output", "results.jsonl"),
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: directory },
      timeout: 10_000,
    },
  );
}

async function assertNoOutput(directory: string) {
  await assert.rejects(access(join(directory, "output")));
}

test("replay fails without creating output when selected task has no rows", async () => {
  await withReplay(await readFile(archive, "utf8"), async (directory) => {
    const result = replay(directory, "status-extraction");

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no replay records match selected tasks/i);
    await assertNoOutput(directory);
  });
});

test("replay fails without creating output for an empty input", async () => {
  await withReplay("", async (directory) => {
    const result = replay(directory, "json-transform");

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no replay records match selected tasks/i);
    await assertNoOutput(directory);
  });
});

test("replay preserves archived measurements for a matching valid row", async () => {
  const row = archivedRows.find(
    (candidate) =>
      candidate.model === "gpt-6-luna" &&
      candidate.task === "json-transform" &&
      candidate.status === "completed" &&
      candidate.evaluation?.passed === true,
  );
  assert.ok(row, "expected a passing archived json-transform row");

  await withReplay(`${JSON.stringify(row)}\n`, async (directory) => {
    const result = replay(directory, "json-transform");
    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(
      (
        await readFile(join(directory, "output", "results.jsonl"), "utf8")
      ).trim(),
    );
    assert.equal(output.model, row.model);
    assert.equal(output.task, row.task);
    assert.equal(output.replayStatus, "reevaluated");
    assert.equal(output.evaluation.passed, true);
    assert.equal(output.durationMs, row.durationMs);
    assert.deepEqual(output.usage, row.usage);
    assert.deepEqual(output.response, row.response);
  });
});

test("replay keeps a matching archived failure nonzero", async () => {
  const row = archivedRows.find(
    (candidate) =>
      candidate.model === "gpt-6-luna" &&
      candidate.task === "private-object-permissions" &&
      candidate.status === "completed" &&
      candidate.evaluation?.passed === false,
  );
  assert.ok(row, "expected an archived failing private-permissions row");

  await withReplay(`${JSON.stringify(row)}\n`, async (directory) => {
    const result = replay(directory, "private-object-permissions");
    assert.equal(result.status, 1);

    const output = JSON.parse(
      (
        await readFile(join(directory, "output", "results.jsonl"), "utf8")
      ).trim(),
    );
    assert.equal(output.replayStatus, "reevaluated");
    assert.equal(output.evaluation.passed, false);
    assert.equal(output.durationMs, row.durationMs);
    assert.deepEqual(output.usage, row.usage);
    assert.deepEqual(output.response, row.response);
  });
});
