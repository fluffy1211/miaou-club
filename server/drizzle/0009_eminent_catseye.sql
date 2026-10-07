CREATE TABLE "account_activity" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"warned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_activity" ADD CONSTRAINT "account_activity_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;