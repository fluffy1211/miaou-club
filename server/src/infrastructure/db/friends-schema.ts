import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
export const friendship = pgTable(
  "friendship",
  {
    id: uuid("id").primaryKey(),
    lowId: text("low_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    highId: text("high_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    unique("friendship_pair").on(t.lowId, t.highId),
    index("friendship_high").on(t.highId),
    check(
      "friendship_order",
      sql`${t.lowId} collate "C" < ${t.highId} collate "C"`,
    ),
    check("friendship_sender", sql`${t.senderId} in (${t.lowId},${t.highId})`),
    check(
      "friendship_state",
      sql`(${t.state}='pending' and ${t.acceptedAt} is null) or (${t.state}='accepted' and ${t.acceptedAt} is not null)`,
    ),
  ],
);
// No target, pair or request ID: counters cannot reconstruct the social graph.
export const friendAttempt = pgTable(
  "friend_attempt",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    index("friend_attempt_window").on(t.ownerId, t.createdAt),
  ],
);
