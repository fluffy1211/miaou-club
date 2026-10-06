CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "admission" (
	"email" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_normalized" CHECK ("admission"."email" = lower(trim("admission"."email")))
);
--> statement-breakpoint
CREATE TABLE "auth_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"type" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"avatar" text DEFAULT 'initials' NOT NULL,
	CONSTRAINT "profile_handle_unique" UNIQUE("handle"),
	CONSTRAINT "profile_handle" CHECK ("profile"."handle" is null or "profile"."handle" ~ '^[a-z0-9_]{3,30}$'),
	CONSTRAINT "profile_color" CHECK ("profile"."color" in ('violet','corail','sauge'))
);
--> statement-breakpoint
CREATE TABLE "security_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"target" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_security" (
	"session_id" text PRIMARY KEY NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	"reauthenticated_at" timestamp with time zone NOT NULL,
	"mfa_at" timestamp with time zone,
	"admin_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_policy" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_policy" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "user_policy" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_policy" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "user_policy" ADD COLUMN "recovery_enrolled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_policy" ADD COLUMN "recovery_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_security" ADD CONSTRAINT "session_security_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user_policy" ADD CONSTRAINT "user_policy_role" CHECK ("user_policy"."role" in ('user','admin'));