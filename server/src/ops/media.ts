import "dotenv/config";
import { Effect } from "effect";
import { createDatabase, closePool } from "../infrastructure/db/client.js";
import { Encounters } from "../encounters/service.js";
import { storageFromEnvironment } from "../encounters/storage.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { pool } = createDatabase(process.env.DATABASE_URL);
try {
  await Effect.runPromise(
    Effect.tryPromise({
      try: () => new Encounters(pool, storageFromEnvironment()).maintenance(),
      catch: () => new Error("Media maintenance failed"),
    }),
  );
  console.log(
    JSON.stringify({ component: "media", code: "maintenance_complete" }),
  );
} finally {
  await closePool(pool);
}
