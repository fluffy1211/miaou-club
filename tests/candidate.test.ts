import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  readFile,
  copyFile,
  mkdir,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { verifyCandidate } from "../scripts/candidate.mjs";
const sha = "1".repeat(40);
const run = {
  status: "completed",
  conclusion: "success",
  event: "push",
  path: ".github/workflows/ci.yml",
  head_branch: "develop",
  head_sha: sha,
};
test("promotion verifies the exact artifact and rejects wrong source, commit, corruption, manifests and symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-candidate-")),
    image = Buffer.from("synthetic-docker-archive");
  try {
    await writeFile(join(dir, "image.tar"), image);
    await writeFile(join(dir, "image-id.txt"), "sha256:" + "2".repeat(64));
    await writeFile(join(dir, "commit.txt"), sha);
    const manifest =
      createHash("sha256").update(image).digest("hex") + "  image.tar\n";
    await writeFile(join(dir, "SHA256SUMS"), manifest);
    assert.equal(
      (await verifyCandidate(dir, run, "preproduction", sha)).sha,
      sha,
    );
    for (const changed of [
      { event: "pull_request" },
      { head_branch: "main" },
      { head_sha: "3".repeat(40) },
      { path: "other.yml" },
      { conclusion: "failure" },
    ])
      await assert.rejects(
        verifyCandidate(dir, { ...run, ...changed }, "preproduction", sha),
      );
    await assert.rejects(verifyCandidate(dir, run, "production", sha));
    await writeFile(join(dir, "image.tar"), "corrupted");
    await assert.rejects(verifyCandidate(dir, run, "preproduction", sha));
    await writeFile(join(dir, "image.tar"), image);
    await writeFile(
      join(dir, "SHA256SUMS"),
      manifest.replace("image.tar", "../image.tar"),
    );
    await assert.rejects(verifyCandidate(dir, run, "preproduction", sha));
    await writeFile(join(dir, "SHA256SUMS"), manifest);
    await rm(join(dir, "commit.txt"));
    await symlink(join(dir, "image-id.txt"), join(dir, "commit.txt"));
    await assert.rejects(verifyCandidate(dir, run, "preproduction", sha));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run-only validates source metadata without requiring an artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-candidate-run-"));
  const metadata = join(dir, "run.json");
  try {
    await writeFile(metadata, JSON.stringify(run));
    const valid = spawnSync(
      process.execPath,
      ["scripts/candidate.mjs", "--run-only", metadata, "preproduction", sha],
      { encoding: "utf8" },
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), {
      component: "promotion",
      code: "run_verified",
      sha,
      target: "preproduction",
    });

    for (const [candidateRun, target, candidateSha] of [
      [run, "preproduction", "3".repeat(40)],
      [run, "production", sha],
      [{ ...run, head_branch: "main" }, "preproduction", sha],
      [{ ...run, status: "in_progress" }, "preproduction", sha],
    ] as const) {
      await writeFile(metadata, JSON.stringify(candidateRun));
      const invalid = spawnSync(
        process.execPath,
        ["scripts/candidate.mjs", "--run-only", metadata, target, candidateSha],
        { encoding: "utf8" },
      );
      assert.equal(invalid.status, 1);
      assert.deepEqual(JSON.parse(invalid.stderr), {
        component: "promotion",
        code: "candidate_rejected",
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("promotion workflow rejects invalid run metadata before calling artifact download", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miaou-candidate-workflow-"));
  const bin = join(dir, "bin");
  const gh = join(bin, "gh");
  const runFile = join(dir, "run-fixture.json");
  const downloadMarker = join(dir, "download-called");
  try {
    await mkdir(bin);
    await mkdir(join(dir, "scripts"));
    await copyFile(
      resolve(process.cwd(), "scripts/candidate.mjs"),
      join(dir, "scripts/candidate.mjs"),
    );
    await writeFile(
      gh,
      '#!/bin/sh\nif [ "$1" = api ]; then cat "$RUN_FIXTURE"; exit 0; fi\nif [ "$1" = run ] && [ "$2" = download ]; then touch "$DOWNLOAD_MARKER"; exit 73; fi\nexit 91\n',
    );
    await chmod(gh, 0o755);
    const workflow = await readFile(
      new URL("../.github/workflows/promotion-preflight.yml", import.meta.url),
      "utf8",
    );
    const step = workflow.match(
      /\n {6}- name: Validate candidate source and download exact artifact\n {8}env:[\s\S]*?\n {8}run: \|\n((?: {10}.*\n)+)/,
    );
    assert.ok(step);
    const script = step[1]
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(10))
      .join("\n");
    const execute = async (
      candidateRun: object,
      target: string,
      candidateSha: string,
      runId = "12345",
    ) => {
      await writeFile(runFile, JSON.stringify(candidateRun));
      await rm(downloadMarker, { force: true });
      return spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
        cwd: dir,
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          RUN_FIXTURE: runFile,
          DOWNLOAD_MARKER: downloadMarker,
          GH_TOKEN: "synthetic-token",
          GH_REPO: "example/repository",
          CANDIDATE_RUN: runId,
          CANDIDATE_SHA: candidateSha,
          TARGET: target,
          GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
        },
      });
    };

    for (const [candidateRun, target, candidateSha, runId] of [
      [run, "preproduction", "3".repeat(40), "12345"],
      [{ ...run, head_branch: "main" }, "preproduction", sha, "12345"],
      [run, "production", sha, "12345"],
      [{ ...run, status: "in_progress" }, "preproduction", sha, "12345"],
      [run, "preproduction", sha, "not-numeric"],
    ] as const) {
      const rejected = await execute(candidateRun, target, candidateSha, runId);
      assert.equal(
        rejected.status,
        1,
        `${target} ${candidateSha} ${runId}: ${rejected.stderr}`,
      );
      await assert.rejects(readFile(downloadMarker));
    }

    const accepted = await execute(run, "preproduction", sha);
    assert.equal(accepted.status, 73, accepted.stderr);
    assert.equal(await readFile(downloadMarker, "utf8"), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
