import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
