import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/** A new group's overlap threshold, in percent. */
const DEFAULT_OVERLAP_THRESHOLD = 50;

/** A group of people finding a time to meet. Its owner runs the votes. */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Percent of members (0 to 100) who must share a slot before a normal vote may start. */
    overlapThreshold: integer('overlap_threshold').notNull().default(DEFAULT_OVERLAP_THRESHOLD),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_groups_owner_id').on(table.ownerId)],
);

/** A group row as read. */
export type Group = typeof groups.$inferSelect;
/** A group row as inserted. */
export type NewGroup = typeof groups.$inferInsert;
