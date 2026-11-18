import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Someone who signs in by magic link. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lower-cased and trimmed before it is written. */
    email: text('email').notNull(),
    /** null until the user sets one. */
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_users_email').on(table.email)],
);

/** A user row as read. */
export type User = typeof users.$inferSelect;
/** A user row as inserted. */
export type NewUser = typeof users.$inferInsert;
