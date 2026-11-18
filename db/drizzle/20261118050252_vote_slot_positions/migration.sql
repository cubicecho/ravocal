DROP INDEX "idx_vote_slots_vote_id";--> statement-breakpoint
ALTER TABLE "vote_slots" ADD COLUMN "position" integer;--> statement-breakpoint
-- Slots written before this column were inserted in ballot order, which is the order Postgres still holds them in.
UPDATE "vote_slots" SET "position" = "ranked"."position" FROM (
	SELECT "id", row_number() OVER (PARTITION BY "vote_id" ORDER BY ctid) - 1 AS "position" FROM "vote_slots"
) AS "ranked" WHERE "vote_slots"."id" = "ranked"."id";--> statement-breakpoint
ALTER TABLE "vote_slots" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vote_slots_vote_id_position" ON "vote_slots" ("vote_id","position");--> statement-breakpoint
-- Nothing stopped a second open vote before this index: keep each group's newest one open.
UPDATE "votes" SET "status" = 'closed', "closed_at" = now() WHERE "status" = 'active' AND "id" NOT IN (
	SELECT DISTINCT ON ("group_id") "id" FROM "votes" WHERE "status" = 'active' ORDER BY "group_id", "created_at" DESC
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_votes_group_id_active" ON "votes" ("group_id") WHERE "status" = 'active';
