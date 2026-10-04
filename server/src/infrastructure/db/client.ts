import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export function createDatabase(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  return { pool, db: drizzle(pool) };
}
export type Database = ReturnType<typeof createDatabase>["db"];
