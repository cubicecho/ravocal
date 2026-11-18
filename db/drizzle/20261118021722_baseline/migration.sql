CREATE TABLE "group_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"overlap_threshold" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"vote_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"vote_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"overlap_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_forced" boolean DEFAULT false NOT NULL,
	"winner_slot_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_group_invites_token" ON "group_invites" ("token");--> statement-breakpoint
CREATE INDEX "idx_group_invites_group_id" ON "group_invites" ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_group_members_group_id_user_id" ON "group_members" ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_user_id" ON "group_members" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_groups_owner_id" ON "groups" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_magic_links_token" ON "magic_links" ("token");--> statement-breakpoint
CREATE INDEX "idx_magic_links_user_id" ON "magic_links" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_time_blocks_group_id" ON "time_blocks" ("group_id");--> statement-breakpoint
CREATE INDEX "idx_time_blocks_user_id" ON "time_blocks" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vote_rankings_vote_id_user_id_slot_id" ON "vote_rankings" ("vote_id","user_id","slot_id");--> statement-breakpoint
CREATE INDEX "idx_vote_rankings_user_id" ON "vote_rankings" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_vote_rankings_slot_id" ON "vote_rankings" ("slot_id");--> statement-breakpoint
CREATE INDEX "idx_vote_slots_vote_id" ON "vote_slots" ("vote_id");--> statement-breakpoint
CREATE INDEX "idx_votes_group_id" ON "votes" ("group_id");--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vote_rankings" ADD CONSTRAINT "vote_rankings_vote_id_votes_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vote_rankings" ADD CONSTRAINT "vote_rankings_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vote_rankings" ADD CONSTRAINT "vote_rankings_slot_id_vote_slots_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "vote_slots"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vote_slots" ADD CONSTRAINT "vote_slots_vote_id_votes_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;