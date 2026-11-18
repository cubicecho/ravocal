import { randomBytes } from 'node:crypto';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

/** Random bytes in an invite's token: as hard to guess as a session's. */
const TOKEN_BYTES = 32;

/** An invitation to join a group. Whoever opens its link while signed in becomes a member, once. */
export const groupInvites = pgTable(
  'group_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Who the link was emailed to. Anyone holding it may join. */
    email: text('email').notNull(),
    /** The link's secret, hex encoded. Made when the row is, and never served through the schema. */
    token: text('token')
      .notNull()
      .$defaultFn(() => randomBytes(TOKEN_BYTES).toString('hex')),
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
