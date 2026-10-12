#!/usr/bin/env node
// Synthetic exploratory benchmark; wall time includes CLI/harness overhead, not model latency alone.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  appendFile,
  mkdir,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

const schema = {
  type: "object",
  properties: {
    solution: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
  },
  required: ["solution", "findings"],
  additionalProperties: false,
};
const cases = [
  {
    id: "json-transform",
    prompt:
      "Return a JavaScript function expression transform(rows). Rows have integer id, string value, boolean active. Keep only active === true. For duplicate ids, keep the first active row in input order. Sort by id ascending and return objects with only id and value. Never mutate input. No dependencies. Put code in solution and [] in findings.",
    tests: [
      { args: [[]], expected: [] },
      {
        args: [
          [
            { id: 11, value: "eleven", active: true },
            { id: 2, value: "two", active: true },
            { id: 10, value: "ten", active: true },
          ],
        ],
        expected: [
          { id: 2, value: "two" },
          { id: 10, value: "ten" },
          { id: 11, value: "eleven" },
        ],
      },
      {
        args: [
          [
            { id: 2, value: "b", active: true },
            { id: 1, value: "off", active: false },
            { id: 1, value: "a", active: true },
            { id: 2, value: "c", active: true },
          ],
        ],
        expected: [
          { id: 1, value: "a" },
          { id: 2, value: "b" },
        ],
      },
      {
        args: [
          [
            { id: 0, value: "zero", active: true },
            { id: -1, value: "neg", active: true },
            { id: 3, value: "off", active: false },
          ],
        ],
        expected: [
          { id: -1, value: "neg" },
          { id: 0, value: "zero" },
        ],
      },
    ],
    good: "(rows) => [...new Map(rows.filter(r => r.active === true).reverse().map(r => [r.id,{id:r.id,value:r.value}])).values()].sort((a,b)=>a.id-b.id)",
    mutants: [
      "rows => rows",
      "rows => { rows.reverse(); return []; }",
      "rows => { while(true) {} }",
      "rows => [...new Map(rows.filter(r=>r.active===true).reverse().map(r=>[r.id,{id:r.id,value:r.value}])).values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)))",
    ],
  },
  {
    id: "pagination-boundaries",
    prompt:
      "Fix this JavaScript function: (items,page,size)=>items.slice((page-1)*size,page*size). Return a function expression paginate(items,page,size) returning {items,page,totalPages}. Do not mutate input. Valid size is a finite integer >=1, otherwise use 10. totalPages=Math.max(1,Math.ceil(items.length/size)). Valid page is a finite integer >=1, otherwise use 1; clamp it to totalPages. Return the corresponding slice. No dependencies. Put code in solution and [] in findings.",
    tests: [
      { args: [[], 3, 2], expected: { items: [], page: 1, totalPages: 1 } },
      {
        args: [Array.from({ length: 21 }, (_, i) => i + 1), 2, 0],
        expected: {
          items: Array.from({ length: 10 }, (_, i) => i + 11),
          page: 2,
          totalPages: 3,
        },
      },
      {
        args: [[1, 2, 3, 4, 5], 2, 2],
        expected: { items: [3, 4], page: 2, totalPages: 3 },
      },
      {
        args: [[1, 2, 3], 999, 2],
        expected: { items: [3], page: 2, totalPages: 2 },
      },
      {
        args: [[1, 2, 3], -1, 0],
        expected: { items: [1, 2, 3], page: 1, totalPages: 1 },
      },
      {
        args: [[1, 2, 3], 1.5, 1.5],
        expected: { items: [1, 2, 3], page: 1, totalPages: 1 },
      },
      {
        args: [[1, 2, 3], "2", "2"],
        expected: { items: [1, 2, 3], page: 1, totalPages: 1 },
      },
      {
        args: [[1, 2, 3], null, null],
        expected: { items: [1, 2, 3], page: 1, totalPages: 1 },
      },
    ],
    special: "[ [ [1,2,3], Infinity, NaN ], [ [1,2,3], NaN, Infinity ] ]",
    good: "(items,page,size) => { size=Number.isFinite(size)&&Number.isInteger(size)&&size>=1?size:10; const totalPages=Math.max(1,Math.ceil(items.length/size)); page=Number.isFinite(page)&&Number.isInteger(page)&&page>=1?Math.min(page,totalPages):1; return {items:items.slice((page-1)*size,page*size),page,totalPages}; }",
    mutants: [
      "(items,page,size) => ({items:items.slice((page-1)*size,page*size),page,totalPages:Math.ceil(items.length/size)})",
      "(items,page,size) => { items.pop(); return {items,page:1,totalPages:1}; }",
      "(items,page,size) => { size=Number.isFinite(size)&&Number.isInteger(size)&&size>=1?size:100; const totalPages=Math.max(1,Math.ceil(items.length/size)); page=Number.isFinite(page)&&Number.isInteger(page)&&page>=1?Math.min(page,totalPages):1; return {items:items.slice((page-1)*size,page*size),page,totalPages}; }",
    ],
  },
  {
    id: "private-object-permissions",
    prompt: `Review this function against these rules: suspended authenticated viewers cannot read any object, including their own; an active owner can read their private object; public objects are readable anonymously; non-owner private access is denied. Code: function canRead(viewer,object) { if (viewer?.id === object.ownerId) return true; if (object.visibility === 'public') return true; if (viewer?.suspended) return false; return false; } Return only confirmed findings using these ids: suspended_owner_bypass, suspended_public_bypass, active_owner_private_leak, anonymous_private_leak, anonymous_public_leak. Use solution:"". Avoid false positives.`,
    expected: ["suspended_owner_bypass", "suspended_public_bypass"],
    good: "",
    mutants: [],
  },
  {
    id: "status-extraction",
    prompt:
      'Extract IDs of rows whose status is exactly OPEN, preserving source order. Rows: [{"id":"M-8","status":"OPEN"},{"id":"M-21","status":"OPEN"},{"id":"M-5","status":"CLOSED"},{"id":"M-13","status":"REOPENED"},{"id":"M-1","status":"OPENED"}]. Return solution as a string containing a JSON array of IDs, and findings as []. No code or explanation.',
    extraction: ["M-8", "M-21"],
    good: '["M-8","M-21"]',
    mutants: [
      "[]",
      '["M-8"]',
      '["M-8","M-21","M-13"]',
      '["M-8","M-21","M-1"]',
      '["M-8","M-21","M-8"]',
    ],
  },
];

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const promptHash = (task) =>
  hash({ prompt: task.prompt, schema, instructionVersion: 1 });
const oracleHash = (task) =>
  hash({
    evaluatorVersion: 2,
    tests: task.tests,
    special: task.special,
    expected: task.expected,
    extraction: task.extraction,
  });

function evaluate(task, response) {
  if (
    !response ||
    typeof response.solution !== "string" ||
    !Array.isArray(response.findings) ||
    response.findings.some((x) => typeof x !== "string") ||
    Object.keys(response).sort().join(",") !== "findings,solution"
  )
    return { passed: false, reason: "Invalid response schema" };
  if (task.extraction) {
    try {
      assert.equal(response.findings.length, 0);
      assert.deepEqual(JSON.parse(response.solution), task.extraction);
      return { passed: true, reason: null };
    } catch {
      return {
        passed: false,
        reason: "Missing, extraneous, duplicate, or reordered extracted ID",
      };
    }
  }
  if (task.expected) {
    const passed =
      response.solution === "" &&
      JSON.stringify([...response.findings].sort()) ===
        JSON.stringify([...task.expected].sort());
    return {
      passed,
      reason: passed ? null : "Missing finding, duplicate, or false positive",
    };
  }
  if (response.findings.length)
    return { passed: false, reason: "Unexpected findings for coding case" };
  try {
    const context = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    });
    // All candidate execution stays within timed VM calls; no host functions or objects are injected.
    new vm.Script(
      `const candidate = (${response.solution}); if(typeof candidate !== 'function') throw Error('Function required');`,
    ).runInContext(context, { timeout: 200 });
    const tests = task.tests.map((t) => ({
      source: JSON.stringify(t.args),
      expected: t.expected,
    }));
    if (task.special)
      for (let i = 0; i < 2; i++)
        tests.push({
          source: `(${task.special})[${i}]`,
          expected: { items: [1, 2, 3], page: 1, totalPages: 1 },
        });
    for (const test of tests) {
      const actual = new vm.Script(
        `JSON.stringify((()=>{ const args=${test.source}; const before=JSON.stringify(args); const result=candidate(...args); if(JSON.stringify(args)!==before) throw Error('Input mutated'); return result; })())`,
      ).runInContext(context, { timeout: 200 });
      assert.deepEqual(JSON.parse(actual), test.expected);
    }
    return { passed: true, reason: null, checks: tests.length };
  } catch {
    return {
      passed: false,
      reason: "Oracle mismatch, mutation, invalid code, or VM limit",
    };
  }
}

function selfTest() {
  for (const task of cases) {
    assert.equal(
      evaluate(task, { solution: task.good, findings: task.expected ?? [] })
        .passed,
      true,
      `${task.id}: good candidate`,
    );
    for (const solution of task.mutants)
      assert.equal(
        evaluate(task, { solution, findings: [] }).passed,
        false,
        `${task.id}: mutant`,
      );
  }
  const review = cases[2];
  for (const findings of [
    [],
    ["suspended_owner_bypass"],
    [...review.expected, "active_owner_private_leak"],
    [...review.expected, "anonymous_private_leak"],
    [...review.expected, "anonymous_public_leak"],
    [...review.expected, review.expected[0]],
  ])
    assert.equal(evaluate(review, { solution: "", findings }).passed, false);
  console.log(
    "Self-test passed: valid solutions accepted; incorrect, mutating, looping, missing and false-positive candidates rejected.",
  );
}

function options(argv) {
  const out = {
    models: ["gpt-5.6-luna", "gpt-6-luna", "gpt-6.1-sol"],
    runs: 1,
    timeout: 180,
    output: null,
    tasks: cases.map((task) => task.id),
    replay: null,
    dryRun: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--dry-run") out.dryRun = true;
    else if (key === "--self-test") out.selfTest = true;
    else if (
      [
        "--models",
        "--runs",
        "--output",
        "--timeout-seconds",
        "--tasks",
        "--replay",
      ].includes(key)
    ) {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        throw Error(`Missing value for ${key}`);
      if (key === "--models")
        out.models = [
          ...new Set(
            value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ];
      if (key === "--runs") out.runs = Number(value);
      if (key === "--output") out.output = resolve(value);
      if (key === "--timeout-seconds") out.timeout = Number(value);
      if (key === "--tasks")
        out.tasks = [
          ...new Set(
            value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ];
      if (key === "--replay") out.replay = resolve(value);
    } else throw Error(`Unknown option: ${key}`);
  }
  if (
    !out.models.length ||
    out.models.some((m) => !/^[a-zA-Z0-9_.:/-]+$/.test(m))
  )
    throw Error("Invalid models");
  if (!Number.isInteger(out.runs) || out.runs < 1 || out.runs > 100)
    throw Error("Runs must be 1..100");
  if (!Number.isFinite(out.timeout) || out.timeout < 1 || out.timeout > 3600)
    throw Error("Timeout must be 1..3600 seconds");
  if (
    !out.tasks.length ||
    out.tasks.some((id) => !cases.some((task) => task.id === id))
  )
    throw Error("Invalid task IDs");
  if (out.replay && out.output === out.replay)
    throw Error("Replay output must differ from input");
  if (!out.dryRun && !out.selfTest && !out.output)
    throw Error("Provide --output PATH for a live benchmark");
  return out;
}

function execute(model, task, directory, schemaPath, timeout) {
  return new Promise((resolveRun) => {
    const started = performance.now();
    const args = [
      "exec",
      "--model",
      model,
      "-c",
      'model_reasoning_effort="low"',
      "-c",
      "agents.enabled=false",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--output-schema",
      schemaPath,
      "-C",
      directory,
      "-",
    ];
    const child = spawn("codex", args, {
      cwd: directory,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "",
      responseText = null,
      usage = null,
      stderr = "",
      timedOut = false,
      spawnError = null,
      overflow = false,
      turnError = null;
    function event(line) {
      try {
        const data = JSON.parse(line);
        if (
          data.type === "item.completed" &&
          data.item?.type === "agent_message"
        )
          responseText = data.item.text.slice(0, 100_000);
        if (data.type === "turn.completed" && data.usage) usage = data.usage;
        if (data.type === "turn.failed")
          turnError = data.error?.message ?? "Turn failed";
        if (data.type === "error")
          turnError = data.message ?? "CLI event error";
      } catch {
        /* Non-JSON CLI output is not saved. */
      }
    }
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        event(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 1_000_000) {
        buffer = "";
        overflow = true;
        kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      spawnError = error.code ?? error.message;
    });
    function kill(signal) {
      if (!child.pid) return;
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          signal,
        );
      } catch {
        /* Already exited. */
      }
    }
    let hardKill;
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      hardKill = setTimeout(() => kill("SIGKILL"), 500);
    }, timeout * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Kill remaining group members even if the CLI exits before its children.
      if (timedOut || overflow) kill("SIGKILL");
      clearTimeout(hardKill);
      if (buffer) event(buffer);
      let response = null;
      try {
        response = JSON.parse(responseText);
      } catch {
        /* Missing or invalid structured result. */
      }
      const status = timedOut
        ? "timeout"
        : overflow
          ? "output_limit"
          : spawnError
            ? "spawn_error"
            : code !== 0 || turnError
              ? "cli_error"
              : response
                ? "completed"
                : "invalid_response";
      resolveRun({
        status,
        exitCode: code,
        signal,
        durationMs: Math.round(performance.now() - started),
        usage,
        response,
        evaluation: status === "completed" ? evaluate(task, response) : null,
        error:
          spawnError ??
          turnError ??
          (status === "cli_error"
            ? stripVTControlCharacters(stderr).trim()
            : null),
      });
    });
    child.stdin.end(
      `You are solving a synthetic benchmark in an empty temporary directory. Do not inspect files, use tools, delegate, or access the network. Answer only JSON conforming to the provided schema.\n${task.prompt}\n`,
    );
  });
}

async function main() {
  const opts = options(process.argv.slice(2));
  const selected = cases.filter((task) => opts.tasks.includes(task.id));
  if (opts.selfTest) {
    selfTest();
    return;
  }
  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          models: opts.models,
          runs: opts.runs,
          tasks: selected.map((c) => ({
            id: c.id,
            prompt: c.prompt,
            promptHash: promptHash(c),
            oracleHash: oracleHash(c),
          })),
          timeoutSeconds: opts.timeout,
          output: opts.output,
          replay: opts.replay,
          schema,
          caveats: [
            "Synthetic tasks only",
            "One run is exploratory",
            "Wall time includes CLI and harness overhead",
            "No cost ranking without confirmed prices",
            "VM limits are defense in depth, not a hostile-code security boundary",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }
  selfTest();
  if (opts.replay) {
    const rows = (await readFile(opts.replay, "utf8"))
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const matchingRows = rows.filter((row) =>
      selected.some((task) => task.id === row.task),
    );
    if (!matchingRows.length)
      throw Error("No replay records match selected tasks");
    await mkdir(dirname(opts.output), { recursive: true });
    for (const row of matchingRows) {
      const task = selected.find((task) => task.id === row.task);
      const compatible = !row.promptHash || row.promptHash === promptHash(task);
      const usable = row.status === "completed" && row.response && compatible;
      const evaluation = usable ? evaluate(task, row.response) : null;
      await appendFile(
        opts.output,
        JSON.stringify({
          ...row,
          originalEvaluation: row.originalEvaluation ?? row.evaluation,
          evaluation,
          reEvaluatedAt: new Date().toISOString(),
          currentOracleHash: oracleHash(task),
          replayStatus: usable
            ? "reevaluated"
            : compatible
              ? "unavailable"
              : "prompt_changed",
          promptCompatibility: row.promptHash
            ? compatible
              ? "confirmed"
              : "changed"
            : "legacy_unverified",
        }) + "\n",
        { mode: 0o600 },
      );
      console.log(
        `${row.model} ${row.task} replay: passed=${evaluation?.passed ?? "unavailable"}`,
      );
      if (!evaluation?.passed) process.exitCode = 1;
    }
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "miaou-model-benchmark-"));
  try {
    const schemaPath = join(directory, "response-schema.json");
    await writeFile(schemaPath, JSON.stringify(schema));
    await mkdir(dirname(opts.output), { recursive: true });
    for (const model of opts.models)
      for (let run = 1; run <= opts.runs; run++)
        for (const task of selected) {
          const result = await execute(
            model,
            task,
            directory,
            schemaPath,
            opts.timeout,
          );
          await appendFile(
            opts.output,
            JSON.stringify({
              timestamp: new Date().toISOString(),
              benchmarkVersion: 1,
              promptHash: promptHash(task),
              oracleHash: oracleHash(task),
              casesHash: createHash("sha256")
                .update(JSON.stringify(cases))
                .digest("hex"),
              model,
              reasoningEffort: "low",
              run,
              task: task.id,
              ...result,
            }) + "\n",
            { mode: 0o600 },
          );
          console.log(
            `${model} ${task.id} run=${run}: ${result.status}, passed=${result.evaluation?.passed ?? "unavailable"}, duration=${result.durationMs}ms`,
          );
          if (result.status !== "completed" || !result.evaluation?.passed)
            process.exitCode = 1;
        }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
