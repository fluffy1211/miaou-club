import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { user, session } from "./auth-schema.js";
export const admission = pgTable(
  "admission",
  {
    email: text("email").primaryKey(),
    active: boolean("active").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check("admission_normalized", sql`${t.email} = lower(trim(${t.email}))`),
  ],
);
export const profile = pgTable(
  "profile",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    handle: text("handle").unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio").default("").notNull(),
    color: text("color").default("violet").notNull(),
    avatar: text("avatar").default("initials").notNull(),
  },
  (t) => [
    check(
      "profile_handle",
      sql`${t.handle} is null or ${t.handle} ~ '^[a-z0-9_]{3,30}$'`,
    ),
    check("profile_color", sql`${t.color} in ('violet','corail','sauge')`),
  ],
);
export const sessionSecurity = pgTable("session_security", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  authenticatedAt: timestamp("authenticated_at", {
    withTimezone: true,
  }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull(),
  reauthenticatedAt: timestamp("reauthenticated_at", {
    withTimezone: true,
  }).notNull(),
  mfaAt: timestamp("mfa_at", { withTimezone: true }),
  adminUsedAt: timestamp("admin_used_at", { withTimezone: true }),
});
export const authLimit = pgTable("auth_limit", {
  key: text("key").primaryKey(),
  events: jsonb("events").$type<number[]>().default([]).notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const securityAudit = pgTable("security_audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  target: text("target").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const mailAttempt = pgTable("mail_attempt", {
  id: text("id").primaryKey(),
  recipient: text("recipient").notNull(),
  type: text("type").notNull(),
  result: text("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
