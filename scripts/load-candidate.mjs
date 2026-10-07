import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyCandidate } from "./candidate.mjs";
try {
  const [directory, metadata, target, sha] = process.argv.slice(2);
  const candidate = await verifyCandidate(
    directory,
    JSON.parse(await readFile(metadata, "utf8")),
    target,
    sha,
  );
  const load = spawnSync(
    "docker",
    ["load", "--input", join(directory, "image.tar")],
    { encoding: "utf8", timeout: 120000 },
  );
  if (load.error || load.status !== 0) throw new Error("Image load failed");
  const inspect = spawnSync(
    "docker",
    ["image", "inspect", "miaou-candidate:" + sha, "--format", "{{.Id}}"],
    { encoding: "utf8", timeout: 10000 },
  );
  if (
    inspect.error ||
    inspect.status !== 0 ||
    inspect.stdout.trim() !== candidate.imageId
  )
    throw new Error("Loaded image identity mismatch");
  console.log(
    JSON.stringify({
      component: "promotion",
      code: "image_loaded",
      ...candidate,
    }),
  );
} catch {
  console.error(
    JSON.stringify({ component: "promotion", code: "image_rejected" }),
  );
  process.exitCode = 1;
}
