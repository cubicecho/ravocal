import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

/** Where a vote is in its life. */
export const VOTE_STATUSES = ['active', 'closed'] as const;
/** One of `VOTE_STATUSES`. */
export type VoteStatus = (typeof VOTE_STATUSES)[number];

/** A ranked-choice vote over candidate slots, started by a group's owner. */
export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    status: text('status').$type<VoteStatus>().notNull().default('active'),
    /** Whether the owner started it below the group's overlap threshold. */
    isForced: boolean('is_forced').notNull().default(false),
    /** The winning vote slot. null until the vote closes, and after a close with no winner. */
    winnerSlotId: uuid('winner_slot_id'),
    /** null while the vote is active. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_votes_group_id').on(table.groupId)],
);

/** A vote row as read. */
export type Vote = typeof votes.$inferSelect;
/** A vote row as inserted. */
export type NewVote = typeof votes.$inferInsert;
