import "dotenv/config";
import { createDatabase } from "../infrastructure/db/client.js";
import { cleanupAccounts } from "../accounts/cleanup.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await cleanupAccounts(db);
  console.log("Expired authentication data cleaned.");
} finally {
  await pool.end();
}
