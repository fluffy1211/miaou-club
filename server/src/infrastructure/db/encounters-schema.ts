import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  date,
  boolean,
  jsonb,
  check,
  index,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    state: text("state").notNull().default("uploading"),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    originalPresent: boolean("original_present").notNull().default(true),
    attempts: integer("attempts").notNull().default(0),
    purgeAttempts: integer("purge_attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "media_state",
      sql`${t.state} in ('uploading','pending','processing','ready','failed','deleting','deleted')`,
    ),
    check("media_bytes", sql`${t.bytes} between 0 and 30000000`),
    unique("media_owner_identity").on(t.id, t.ownerId),
    check(
      "media_dimensions",
      sql`${t.state} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.width} between 1 and 1920 and ${t.height} between 1 and 1920)`,
    ),
    index("media_work").on(t.state, t.nextAttemptAt),
  ],
);
export const encounter = pgTable(
  "encounter",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    mediaId: text("media_id")
      .notNull()
      .unique()
      .references(() => media.id),
    requestKey: text("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    encounterDate: date("encounter_date").notNull(),
    visibility: text("visibility").notNull().default("public"),
    hidden: boolean("hidden").notNull().default(false),
    hiddenReason: text("hidden_reason"),
    locationContext: jsonb("location_context"),
    locationSize: integer("location_size"),
    locationX: integer("location_x"),
    locationY: integer("location_y"),
    revision: integer("revision").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("encounter_operation").on(t.ownerId, t.requestKey),
    foreignKey({
      name: "encounter_media_owner_fk",
      columns: [t.mediaId, t.ownerId],
      foreignColumns: [media.id, media.ownerId],
    }),
    check("encounter_title", sql`length(trim(${t.title})) between 1 and 120`),
    check("encounter_description", sql`length(${t.description}) <= 2000`),
    check("encounter_visibility", sql`${t.visibility} in ('public','private')`),
    check(
      "encounter_location",
      sql`(${t.locationSize} is null and ${t.locationX} is null and ${t.locationY} is null) or (${t.locationSize} is not null and ${t.locationX} is not null and ${t.locationY} is not null and ${t.locationSize} in (500,1000,2000) and ${t.locationX} between 0 and 2600 and ${t.locationY} between 3000 and 14500)`,
    ),
    index("encounter_notebook").on(t.ownerId, t.publishedAt),
  ],
);
export const uploadAttempt = pgTable(
  "upload_attempt",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("upload_attempt_owner").on(t.ownerId, t.createdAt)],
);
