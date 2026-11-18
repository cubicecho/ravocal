import { groupMembers, groups, timeBlocks, VOTE_ACTIVE, voteRankings, votes } from '@cubicecho/ravocal-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { extendSchema, type GraphQLResolveInfo, type GraphQLSchema, parse } from 'graphql';
import type { Context } from '../core/context.ts';
import { badInput, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { objectType } from '../graphql/object-type.ts';
import { readRow } from '../graphql/read-back.ts';
import { loadOwnedGroup } from './access.ts';
import { createGroupInput } from './input.ts';

const GROUPS_SDL = parse(`
  extend type Mutation {
    "Creates a group owned by the caller, who is its first member. The threshold defaults to 50 (percent)."
    createGroup(name: String!, overlapThreshold: Int): Group!
    "Takes a member out of a group you own, with their free time in it and their ballot in its open vote. A closed vote's result stays. You can't remove yourself."
    removeMember(groupId: UUID!, userId: UUID!): Group!
  }
`);

/**
 * Reads a group back as `Group`, with whatever the caller selected under it.
 *
 * @param info - The mutation's resolve info.
 * @param context - Request context.
 * @param id - The group.
 * @returns The group.
 */
const readGroup = (info: GraphQLResolveInfo, context: Context, id: string) =>
  readRow(info, context, { table: 'groups', where: { id: { eq: id } } });

/**
 * Creates a group and its owner's membership, in one transaction.
 *
 * @param _parent - Unused.
 * @param args - The group's name and threshold.
 * @param context - Request context.
 * @param info - Resolve info, for reading the group back.
 * @returns The new group.
 */
async function createGroup(
  _parent: unknown,
  args: { name: string; overlapThreshold?: number | null },
  context: Context,
  info: GraphQLResolveInfo,
) {
  const ownerId = requireAuth(context);
  const input = parseOrThrow(createGroupInput, {
    name: args.name,
    overlapThreshold: args.overlapThreshold ?? undefined,
  });
  const groupId = await context.db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({ ...input, ownerId })
      .returning({ id: groups.id });
    await tx.insert(groupMembers).values({ groupId: group.id, userId: ownerId });
    return group.id;
  });
  return readGroup(info, context, groupId);
}

/**
 * Removes a member, their time blocks in the group, and their rankings in its open vote.
 *
 * @param _parent - Unused.
 * @param args - The group, and the member to remove.
 * @param context - Request context.
 * @param info - Resolve info, for reading the group back.
 * @returns The group, without them.
 * @throws NOT_FOUND unless the caller owns the group and the user is in it; BAD_USER_INPUT for the owner themselves.
 */
async function removeMember(
  _parent: unknown,
  args: { groupId: string; userId: string },
  context: Context,
  info: GraphQLResolveInfo,
) {
  const ownerId = requireAuth(context);
  await context.db.transaction(async (tx) => {
    await loadOwnedGroup(tx, args.groupId, ownerId);
    if (args.userId === ownerId) {
      throw badInput("You own this group, so you can't remove yourself. Delete the group instead.");
    }
    const isTheirs = and(eq(groupMembers.groupId, args.groupId), eq(groupMembers.userId, args.userId));
    const removed = await tx.delete(groupMembers).where(isTheirs).returning({ id: groupMembers.id });
    if (removed.length === 0) {
      throw notFound('Member not found');
    }
    await tx.delete(timeBlocks).where(and(eq(timeBlocks.groupId, args.groupId), eq(timeBlocks.userId, args.userId)));
    const openVotes = tx
      .select({ id: votes.id })
      .from(votes)
      .where(and(eq(votes.groupId, args.groupId), eq(votes.status, VOTE_ACTIVE)));
    await tx
      .delete(voteRankings)
      .where(and(eq(voteRankings.userId, args.userId), inArray(voteRankings.voteId, openVotes)));
  });
  return readGroup(info, context, args.groupId);
}

/**
 * Adds the group fields CRUD can't express: creating one with its owner's membership, and removing a member.
 *
 * @param schema - Schema to extend.
 * @returns The extended schema.
 */
export function applyGroupsExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, GROUPS_SDL);
  const mutations = objectType(extended, 'Mutation').getFields();
  mutations.createGroup.resolve = createGroup;
  mutations.removeMember.resolve = removeMember;
  return extended;
}
