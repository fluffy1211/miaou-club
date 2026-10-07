import "dotenv/config";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "./migrations.js";
import { createDatabase, closePool } from "./client.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { pool } = createDatabase(url);
try {
  await migrateDatabase(
    pool,
    fileURLToPath(new URL("../../../drizzle", import.meta.url)),
  );
} finally {
  await closePool(pool);
}
