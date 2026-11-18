import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

/** A vote members are still ranking. */
export const VOTE_ACTIVE = 'active' as const;
/** A vote the owner has closed, with its result. */
export const VOTE_CLOSED = 'closed' as const;
/** Where a vote is in its life. */
export const VOTE_STATUSES = [VOTE_ACTIVE, VOTE_CLOSED] as const;
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
    status: text('status', { enum: VOTE_STATUSES }).notNull().default(VOTE_ACTIVE),
    /** Whether the owner started it below the group's overlap threshold. */
    isForced: boolean('is_forced').notNull().default(false),
    /** The winning vote slot. null until the vote closes, and after a close with no winner. */
    winnerSlotId: uuid('winner_slot_id'),
    /** null while the vote is active. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_votes_group_id').on(table.groupId),
    // One open vote per group: the group page reads it as the group's vote.
    uniqueIndex('uq_votes_group_id_active').on(table.groupId).where(sql`${table.status} = ${VOTE_ACTIVE}`),
  ],
);

/** A vote row as read. */
export type Vote = typeof votes.$inferSelect;
/** A vote row as inserted. */
export type NewVote = typeof votes.$inferInsert;
