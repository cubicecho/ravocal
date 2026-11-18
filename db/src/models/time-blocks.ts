import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';
import { users } from './users.ts';

/** A window of time one member is free, on one group's calendar. */
export const timeBlocks = pgTable(
  'time_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** On the hour or the half hour. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** On the hour or the half hour, at least 30 minutes after `startsAt`. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_time_blocks_group_id').on(table.groupId), index('idx_time_blocks_user_id').on(table.userId)],
);

/** A time block row as read. */
export type TimeBlock = typeof timeBlocks.$inferSelect;
/** A time block row as inserted. */
export type NewTimeBlock = typeof timeBlocks.$inferInsert;
