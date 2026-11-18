import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';
import { voteSlots } from './vote-slots.ts';
import { votes } from './votes.ts';

/** Where one member placed one slot on their ballot. */
export const voteRankings = pgTable(
  'vote_rankings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voteId: uuid('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => voteSlots.id, { onDelete: 'cascade' }),
    /** 1 is the top choice. */
    rank: integer('rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_vote_rankings_vote_id_user_id_slot_id').on(table.voteId, table.userId, table.slotId),
    index('idx_vote_rankings_user_id').on(table.userId),
    index('idx_vote_rankings_slot_id').on(table.slotId),
  ],
);

/** A vote ranking row as read. */
export type VoteRanking = typeof voteRankings.$inferSelect;
/** A vote ranking row as inserted. */
export type NewVoteRanking = typeof voteRankings.$inferInsert;
