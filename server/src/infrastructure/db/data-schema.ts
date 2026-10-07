import { sql } from "drizzle-orm";
import { user } from "./auth-schema.js";
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  customType,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true });
const bytes = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const report = pgTable(
  "report",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id").notNull(),
    reporterId: text("reporter_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    closedAt: time("closed_at"),
    outcome: text("outcome"),
  },
  (t) => [
    uniqueIndex("report_open_unique")
      .on(t.reporterId, t.encounterId)
      .where(sql`${t.closedAt} is null`),
    check("report_reason", sql`length(trim(${t.reason})) between 1 and 1000`),
  ],
);
export const moderationAudit = pgTable("moderation_audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  target: text("target").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  reportId: text("report_id"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const reportConsultation = pgTable("report_consultation", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull(),
  sessionId: text("session_id").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  expiresAt: time("expires_at").notNull(),
});
export const dataExport = pgTable(
  "data_export",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: time("next_attempt_at").notNull().defaultNow(),
    createdAt: time("created_at").notNull().defaultNow(),
    generatedAt: time("generated_at"),
    expiresAt: time("expires_at"),
    error: text("error"),
    archive: bytes("archive"),
    manifest: jsonb("manifest"),
  },
  (t) => [
    check("data_export_state", sql`${t.state} in ('pending','ready','failed')`),
    index("data_export_owner").on(t.ownerId),
  ],
);
export const accountDeletion = pgTable("account_deletion", {
  ownerId: text("owner_id").primaryKey(),
  requestedAt: time("requested_at").notNull().defaultNow(),
  completedAt: time("completed_at"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: time("next_attempt_at").notNull().defaultNow(),
});

export const accountActivity = pgTable("account_activity", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lastUsedAt: time("last_used_at").notNull().defaultNow(),
  warnedAt: time("warned_at"),
  nextWarningAt: time("next_warning_at").notNull().defaultNow(),
});
