import { index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { votes } from './votes.ts';

/** A 30-minute candidate slot in a vote. */
export const voteSlots = pgTable(
  'vote_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voteId: uuid('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** 30 minutes after `startsAt`. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** How many members are free for the whole slot. */
    overlapCount: integer('overlap_count').notNull().default(0),
  },
  (table) => [index('idx_vote_slots_vote_id').on(table.voteId)],
);

/** A vote slot row as read. */
export type VoteSlot = typeof voteSlots.$inferSelect;
/** A vote slot row as inserted. */
export type NewVoteSlot = typeof voteSlots.$inferInsert;
