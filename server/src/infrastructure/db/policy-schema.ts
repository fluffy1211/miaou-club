import { pgTable, text, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema.js";

// Server policy is separate from authentication; defaults never grant group access.
export const userPolicy = pgTable(
  "user_policy",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    admitted: boolean("admitted").default(false).notNull(),
    status: text("status").default("active").notNull(),
    role: text("role").default("user").notNull(),
    reason: text("reason"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    termsVersion: text("terms_version"),
    recoveryEnrolled: boolean("recovery_enrolled").default(false).notNull(),
    recoveryPending: boolean("recovery_pending").default(false).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("user_policy_role", sql`${table.role} in ('user','admin')`),
    check(
      "user_policy_status",
      sql`${table.status} in ('active', 'suspended', 'withdrawn', 'deleting')`,
    ),
  ],
);
