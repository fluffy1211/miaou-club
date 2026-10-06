CREATE TABLE "encounter" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"media_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"encounter_date" date NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "encounter_media_id_unique" UNIQUE("media_id"),
	CONSTRAINT "encounter_operation" UNIQUE("owner_id","request_key"),
	CONSTRAINT "encounter_title" CHECK (length(trim("encounter"."title")) between 1 and 120),
	CONSTRAINT "encounter_description" CHECK (length("encounter"."description") <= 2000),
	CONSTRAINT "encounter_visibility" CHECK ("encounter"."visibility" in ('public','private'))
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"original_present" boolean DEFAULT true NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"purge_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_state" CHECK ("media"."state" in ('uploading','pending','processing','ready','failed','deleting','deleted')),
	CONSTRAINT "media_bytes" CHECK ("media"."bytes" between 0 and 30000000)
);
--> statement-breakpoint
CREATE TABLE "upload_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_attempt" ADD CONSTRAINT "upload_attempt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounter_notebook" ON "encounter" USING btree ("owner_id","published_at");--> statement-breakpoint
CREATE INDEX "media_work" ON "media" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "upload_attempt_owner" ON "upload_attempt" USING btree ("owner_id","created_at");