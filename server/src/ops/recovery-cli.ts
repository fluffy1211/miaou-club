import "dotenv/config";
import { readFile, writeFile, lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase, closePool } from "../infrastructure/db/client.js";
import { LocalStorage } from "../encounters/storage.js";
import { copyJournal, restoreJournal } from "./decision-journal.js";
import {
  assertLocalTestDatabase,
  captureBackup,
  captureDecisions,
  restoreBackup,
  seal,
  unseal,
  RecoveryStorage,
  type Backup,
  type Decisions,
} from "./recovery.js";
// Explicit local synthetic data acknowledgement. Never uses DATABASE_URL.
async function key(name: string) {
  const path = process.env[name];
  if (!path) throw new Error("Separate recovery key files required");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error("Private key file required");
  const bytes = await readFile(path);
  if (bytes.length !== 32) throw new Error("32-byte key required");
  return bytes;
}
async function main() {
  const [action, backupFile, decisionsFile] = process.argv.slice(2);
  if (
    !backupFile ||
    !["backup", "decisions", "restore", "journal", "restore-journal"].includes(
      action,
    ) ||
    process.env.MIAOU_SYNTHETIC_RECOVERY !== "1"
  )
    throw new Error("Explicit synthetic recovery command required");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL required");
  assertLocalTestDatabase(url);
  const backupKey = await key("MIAOU_RECOVERY_KEY_FILE");
  const mediaRoot = process.env.MIAOU_LOCAL_MEDIA_DIR;
  if (!mediaRoot) throw new Error("Isolated local objects required");
  const root = resolve(mediaRoot);
  if (
    !root.startsWith(resolve(process.cwd(), ".cache") + "/") &&
    !root.startsWith("/private/tmp/")
  )
    throw new Error("Local media path required");
  const { pool } = createDatabase(url);
  try {
    if (action === "backup") {
      if ((await realpath(root)) !== root)
        throw new Error("Storage symlinks forbidden");
      const backup = await captureBackup(pool, new LocalStorage(root));
      await writeFile(backupFile, seal(backup, backupKey), {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        JSON.stringify({
          component: "recovery",
          code: "backup_created",
          objects: Object.keys(backup.objects).length,
        }),
      );
      return;
    }
    if (!decisionsFile) throw new Error("Independent decisions file required");
    const decisionsKey = await key("MIAOU_DECISIONS_KEY_FILE");
    if (decisionsKey.equals(backupKey))
      throw new Error("Independent keys required");
    const backup = unseal<Backup>(await readFile(backupFile), backupKey);
    if (action === "journal" || action === "restore-journal") {
      const anchors = process.env.MIAOU_JOURNAL_ANCHOR_DIR;
      if (!anchors)
        throw new Error("Separate journal anchor directory required");
      const result =
        action === "journal"
          ? await copyJournal(
              pool,
              backup,
              decisionsFile,
              anchors,
              decisionsKey,
            )
          : await restoreJournal(
              pool,
              new RecoveryStorage(root),
              backup,
              decisionsFile,
              anchors,
              decisionsKey,
            );
      console.log(
        JSON.stringify({
          component: "recovery",
          code: action === "journal" ? "journal_copied" : "restored_closed",
          ...result,
        }),
      );
    } else if (action === "decisions") {
      const decisions = await captureDecisions(pool, backup);
      await writeFile(decisionsFile, seal(decisions, decisionsKey), {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        JSON.stringify({ component: "recovery", code: "decisions_captured" }),
      );
    } else {
      const decisions = unseal<Decisions>(
        await readFile(decisionsFile),
        decisionsKey,
      );
      const result = await restoreBackup(
        pool,
        new RecoveryStorage(root),
        backup,
        decisions,
      );
      console.log(
        JSON.stringify({
          component: "recovery",
          code: "restored_closed",
          ...result,
        }),
      );
    }
  } finally {
    await closePool(pool);
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({ component: "recovery", code: "recovery_failed" }),
  );
  process.exitCode = 1;
});
