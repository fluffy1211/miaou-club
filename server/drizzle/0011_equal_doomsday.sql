CREATE TABLE "friend_attempt" (
	"owner_id" text NOT NULL,
	"id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_attempt_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "friendship" (
	"id" uuid PRIMARY KEY NOT NULL,
	"low_id" text NOT NULL,
	"high_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendship_pair" UNIQUE("low_id","high_id"),
	CONSTRAINT "friendship_order" CHECK ("friendship"."low_id" collate "C" < "friendship"."high_id" collate "C"),
	CONSTRAINT "friendship_sender" CHECK ("friendship"."sender_id" in ("friendship"."low_id","friendship"."high_id")),
	CONSTRAINT "friendship_state" CHECK (("friendship"."state"='pending' and "friendship"."accepted_at" is null) or ("friendship"."state"='accepted' and "friendship"."accepted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "friend_attempt" ADD CONSTRAINT "friend_attempt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_low_id_user_id_fk" FOREIGN KEY ("low_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_high_id_user_id_fk" FOREIGN KEY ("high_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_attempt_window" ON "friend_attempt" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "friendship_high" ON "friendship" USING btree ("high_id");