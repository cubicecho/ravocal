import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';
import { users } from './users.ts';

/** A user's membership of a group. The owner is a member too. */
export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_group_members_group_id_user_id').on(table.groupId, table.userId),
    index('idx_group_members_user_id').on(table.userId),
  ],
);

/** A group member row as read. */
export type GroupMember = typeof groupMembers.$inferSelect;
/** A group member row as inserted. */
export type NewGroupMember = typeof groupMembers.$inferInsert;
