import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

/** An emailed invitation to join a group. Accepting it makes a group member. */
export const groupInvites = pgTable(
  'group_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** 32 random bytes, hex encoded. */
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** null while the invite is pending. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_group_invites_token').on(table.token),
    index('idx_group_invites_group_id').on(table.groupId),
  ],
);

/** A group invite row as read. */
export type GroupInvite = typeof groupInvites.$inferSelect;
/** A group invite row as inserted. */
export type NewGroupInvite = typeof groupInvites.$inferInsert;
