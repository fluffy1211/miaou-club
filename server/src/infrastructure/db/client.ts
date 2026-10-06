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

// pg Pool.end() removes idle clients from its list before their socket ends.
// Wait for public remove events as well before dropping an isolated database.
export async function closePool(pool: Pool) {
  if (pool.ending) throw new Error("Pool shutdown already started");
  let remaining = pool.totalCount;
  const removed = new Promise<void>((resolve) => {
    if (!remaining) {
      resolve();
      return;
    }
    const onRemove = () => {
      remaining--;
      if (!remaining) {
        pool.off("remove", onRemove);
        resolve();
      }
    };
    pool.on("remove", onRemove);
  });
  await Promise.all([pool.end(), removed]);
}
