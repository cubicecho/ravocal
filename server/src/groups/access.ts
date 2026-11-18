import { type Group, groupMembers, groups } from '@cubicecho/ravocal-db/schema';
import { and, eq } from 'drizzle-orm';
import { notFound } from '../core/errors.ts';
import type { Executor } from '../graphql/write-guards.ts';

// Hand-written resolvers don't inherit `scope`, so they load their group through these. Every refusal is the same
// NOT_FOUND, whether the group is missing, the caller isn't in it, or the caller isn't its owner: a caller can't tell
// another group's id from a made-up one.

/** What a refusal says unless the caller asked for something else in the group (a vote). */
const GROUP_NOT_FOUND = 'Group not found';

/** Loads a group the caller may act on, or refuses with NOT_FOUND. */
export type GroupLoader = (executor: Executor, groupId: string, userId: string, refusal?: string) => Promise<Group>;

/**
 * Loads a group the caller is a member of.
 *
 * @param executor - The db, or the transaction the caller is writing in.
 * @param groupId - The group.
 * @param userId - The caller.
 * @param [refusal] - What the refusal says.
 * @returns The group.
 * @throws NOT_FOUND when it is missing or the caller isn't in it.
 */
export const loadMemberGroup: GroupLoader = async (executor, groupId, userId, refusal = GROUP_NOT_FOUND) => {
  const [row] = await executor
    .select({ group: groups })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(and(eq(groups.id, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  if (row === undefined) {
    throw notFound(refusal);
  }
  return row.group;
};

/**
 * Loads a group the caller owns.
 *
 * @param executor - The db, or the transaction the caller is writing in.
 * @param groupId - The group.
 * @param userId - The caller.
 * @param [refusal] - What the refusal says.
 * @returns The group.
 * @throws NOT_FOUND when it is missing or someone else's, even when the caller is a member of it.
 */
export const loadOwnedGroup: GroupLoader = async (executor, groupId, userId, refusal = GROUP_NOT_FOUND) => {
  const [group] = await executor
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.ownerId, userId)))
    .limit(1);
  if (group === undefined) {
    throw notFound(refusal);
  }
  return group;
};
