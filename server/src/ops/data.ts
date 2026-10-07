import "dotenv/config";
import { Effect } from "effect";
import { createDatabase, closePool } from "../infrastructure/db/client.js";
import { storageFromEnvironment } from "../encounters/storage.js";
import { inactivitySender } from "../accounts/mail.js";
import { DataManagement } from "../data/service.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new DataManagement(
          pool,
          storageFromEnvironment(),
          process.env.RESEND_API_KEY &&
            process.env.MIAOU_MAIL_FROM &&
            process.env.BETTER_AUTH_URL &&
            process.env.BETTER_AUTH_SECRET
            ? inactivitySender(
                db,
                process.env.RESEND_API_KEY,
                process.env.MIAOU_MAIL_FROM,
                process.env.BETTER_AUTH_URL,
                process.env.BETTER_AUTH_SECRET,
              )
            : undefined,
        ).maintenance(),
      catch: () => new Error("Data maintenance failed"),
    }),
  );
  const pending = await pool.query(
    "select count(*) filter(where requested_at<now()-interval '7 days')::int overdue from account_deletion where completed_at is null",
  );
  console.log(
    JSON.stringify({
      component: "data",
      code: "maintenance_complete",
      overdueDeletions: pending.rows[0].overdue,
    }),
  );
  if (pending.rows[0].overdue) process.exitCode = 1;
} finally {
  await closePool(pool);
}
