import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/** A one-time sign-in link sent by email. */
export const magicLinks = pgTable(
  'magic_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 32 random bytes, hex encoded. */
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** null until the link is redeemed. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_magic_links_token').on(table.token), index('idx_magic_links_user_id').on(table.userId)],
);

/** A magic link row as read. */
export type MagicLink = typeof magicLinks.$inferSelect;
/** A magic link row as inserted. */
export type NewMagicLink = typeof magicLinks.$inferInsert;
