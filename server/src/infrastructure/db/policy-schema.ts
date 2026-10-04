import { pgTable, text, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema.js";

// Deny by default. Admission and consent workflows belong to lot 2.
export const userPolicy = pgTable(
  "user_policy",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    admitted: boolean("admitted").default(false).notNull(),
    status: text("status").default("active").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "user_policy_status",
      sql`${table.status} in ('active', 'suspended', 'withdrawn', 'deleting')`,
    ),
  ],
);
