import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Someone who signs in by magic link. better-auth reads and writes every column. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lower-cased and trimmed before it is written. */
    email: text('email').notNull(),
    /** The part of the address before the `@` until the user sets one. */
    name: text('name').notNull(),
    /** false until a sign-in link has proved the address. */
    emailVerified: boolean('email_verified').notNull().default(false),
    /** better-auth's column for a picture. Ravocal shows none. */
    image: text('image'),
    /**
     * Runs the instance: may change how people sign in (server/src/sso). The first account to be created claims it
     * (server/src/auth/admin.ts); nothing in the API writes it.
     */
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_users_email').on(table.email),
    // One admin at most, so two first sign-ups at once cannot both claim it.
    uniqueIndex('uq_users_one_admin').on(table.isAdmin).where(sql`${table.isAdmin}`),
  ],
);

/** A user row as read. */
export type User = typeof users.$inferSelect;
/** A user row as inserted. */
export type NewUser = typeof users.$inferInsert;
