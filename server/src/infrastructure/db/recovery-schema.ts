import { sql } from "drizzle-orm";
import {
  pgTable,
  boolean,
  uuid,
  bigint,
  text,
  timestamp,
  check,
} from "drizzle-orm/pg-core";

// No subject foreign keys: physical deletion must leave its restriction durable.
export const recoveryState = pgTable(
  "recovery_state",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    sourceId: uuid("source_id").notNull().defaultRandom(),
    head: bigint("head", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    floor: bigint("floor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    check(
      "recovery_state_bounds",
      sql`${t.singleton} and ${t.floor} >= 0 and ${t.head} >= ${t.floor}`,
    ),
  ],
);

export const recoveryDecision = pgTable(
  "recovery_decision",
  {
    seq: bigint("seq", { mode: "bigint" }).primaryKey(),
    code: text("code").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check("recovery_decision_seq", sql`${t.seq} > 0`),
    check(
      "recovery_decision_code",
      sql`${t.code} in ('user_remove','user_suspend','user_withdraw','user_demote','credentials_revoke','encounter_remove','encounter_hide','encounter_private','location_remove','friendship_remove','report_remove','report_close')`,
    ),
  ],
);
