import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function validateRun(run, target, sha) {
  if (
    !["preproduction", "production"].includes(target) ||
    !/^[a-f0-9]{40}$/.test(sha)
  )
    throw new Error("Invalid promotion request");
  if (
    run.conclusion !== "success" ||
    run.status !== "completed" ||
    run.event !== "push" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.head_branch !== (target === "production" ? "main" : "develop") ||
    run.head_sha !== sha
  )
    throw new Error("Candidate run does not match promotion request");
}
export async function verifyCandidate(directory, run, target, sha) {
  validateRun(run, target, sha);
  for (const name of [
    "image.tar",
    "image-id.txt",
    "commit.txt",
    "SHA256SUMS",
  ]) {
    const stat = await lstat(join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Regular candidate files required");
  }
  if ((await readFile(join(directory, "commit.txt"), "utf8")).trim() !== sha)
    throw new Error("Candidate commit mismatch");
  const imageId = (
    await readFile(join(directory, "image-id.txt"), "utf8")
  ).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
    throw new Error("Invalid runtime image identity");
  const manifest = await readFile(join(directory, "SHA256SUMS"), "utf8");
  if (!/^[a-f0-9]{64} {2}image\.tar\n?$/.test(manifest))
    throw new Error("Invalid candidate checksum manifest");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(join(directory, "image.tar")))
    digest.update(chunk);
  if (digest.digest("hex") !== manifest.slice(0, 64))
    throw new Error("Candidate checksum mismatch");
  return { sha, imageId, target };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--run-only") {
      const [, metadata, target, sha] = args;
      validateRun(JSON.parse(await readFile(metadata, "utf8")), target, sha);
      console.log(
        JSON.stringify({
          component: "promotion",
          code: "run_verified",
          sha,
          target,
        }),
      );
    } else {
      const [directory, metadata, target, sha] = args;
      const result = await verifyCandidate(
        directory,
        JSON.parse(await readFile(metadata, "utf8")),
        target,
        sha,
      );
      console.log(
        JSON.stringify({
          component: "promotion",
          code: "candidate_verified",
          ...result,
        }),
      );
    }
  } catch {
    console.error(
      JSON.stringify({ component: "promotion", code: "candidate_rejected" }),
    );
    process.exitCode = 1;
  }
}
