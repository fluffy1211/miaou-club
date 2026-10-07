CREATE TABLE "account_deletion" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_export" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"error" text,
	"archive" "bytea",
	"manifest" jsonb,
	CONSTRAINT "data_export_state" CHECK ("data_export"."state" in ('pending','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "moderation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"target" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"report_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" text PRIMARY KEY NOT NULL,
	"encounter_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "report_reason" CHECK (length(trim("report"."reason")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "report_consultation" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"session_id" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "data_export_owner" ON "data_export" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_open_unique" ON "report" USING btree ("reporter_id","encounter_id") WHERE "report"."closed_at" is null;