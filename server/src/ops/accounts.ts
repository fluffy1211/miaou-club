import "dotenv/config";
import { createDatabase } from "../infrastructure/db/client.js";
import { createAuth } from "../infrastructure/auth/auth.js";
import * as schema from "../infrastructure/db/schema.js";
import { resetSender } from "../accounts/mail.js";
import { operate, type Operation } from "../accounts/operations.js";
// Hosting-only operations: never imported by a public handler.
const [command, value, confirmation, replacementEmail] = process.argv.slice(2);
if (
  !process.env.DATABASE_URL ||
  !process.env.MIAOU_OPERATOR ||
  !process.env.BETTER_AUTH_SECRET ||
  !process.env.BETTER_AUTH_URL
)
  throw new Error(
    "Database, operator and authentication configuration required",
  );
if (
  ![
    "admit",
    "withdraw",
    "suspend",
    "reactivate",
    "admin",
    "recover-mfa",
    "recover-account",
  ].includes(command) ||
  !value
)
  throw new Error(
    "Usage: accounts:ops <operation> <email> [known-contact-confirmed] [replacement-email]",
  );
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const auth = createAuth(
    db,
    {
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      ...(process.env.RESEND_API_KEY && process.env.MIAOU_MAIL_FROM
        ? {
            sendReset: resetSender(
              db,
              process.env.RESEND_API_KEY,
              process.env.MIAOU_MAIL_FROM,
            ),
          }
        : {}),
    },
    schema,
  );
  await operate(
    db,
    auth,
    process.env.MIAOU_OPERATOR,
    command as Operation,
    value,
    confirmation === "known-contact-confirmed",
    replacementEmail,
  );
  console.log("Account operation completed; audit recorded.");
} finally {
  await pool.end();
}
