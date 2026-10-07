import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
// A session lock held on the SAME connection as the migrator also protects
// initial schema creation, before Drizzle's own transaction begins.
export async function migrateDatabase(pool: Pool, migrationsFolder: string) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock(1296646485,6)");
    locked = true;
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    let destroy = !locked;
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock(1296646485,6)");
      } catch {
        destroy = true;
      }
    }
    client.release(destroy);
  }
}
