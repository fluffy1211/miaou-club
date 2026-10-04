CREATE TABLE "user_policy" (
	"user_id" text PRIMARY KEY NOT NULL,
	"admitted" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_policy_status" CHECK ("user_policy"."status" in ('active', 'suspended', 'withdrawn', 'deleting'))
);
--> statement-breakpoint
ALTER TABLE "user_policy" ADD CONSTRAINT "user_policy_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;