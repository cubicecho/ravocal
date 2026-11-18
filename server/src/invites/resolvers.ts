import { groupInvites, groupMembers, groups } from '@cubicecho/ravocal-db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { extendSchema, type GraphQLResolveInfo, type GraphQLSchema, parse } from 'graphql';
import { sendEach } from '../auth/email.ts';
import type { Context } from '../core/context.ts';
import { GROUP_DEFAULTS } from '../core/defaults.ts';
import { badInput, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { MS_PER_DAY } from '../core/wire.ts';
import { objectType } from '../graphql/object-type.ts';
import { readRow } from '../graphql/read-back.ts';
import { loadOwnedGroup } from '../groups/access.ts';
import { inviteEmail } from './email.ts';
import { inviteEmailSchema } from './input.ts';

// An invite's link is the key: whoever opens it while signed in joins, whichever address it was sent to. It works
// once, until it expires, and the owner can cancel it before then.

const INVITES_SDL = parse(`
  extend type Mutation {
    "Emails a link to join a group you own. Whoever opens it while signed in joins, once, within a week."
    inviteToGroup(groupId: UUID!, email: String!): GroupInvite!
    "Joins the group an invite link is for, and spends the link."
    acceptGroupInvite(token: String!): GroupMember!
    "Revokes a pending invite to a group you own, so its link stops working."
    cancelInvite(id: UUID!): Group!
  }
`);

/** What a spent link is told, by whichever acceptance found it spent. */
const INVITE_USED = 'This invite link has already been used. Ask the group owner for a new one.';

/** What a link that names no pending invite is told: cancelled, or never valid. */
const INVITE_NOT_FOUND = 'This invite link does not work. It may have been cancelled, or copied incompletely.';

/**
 * Creates an invite to a group the caller owns, and emails its link once it is saved.
 *
 * @param _parent - Unused.
 * @param args - The group, and the address to email.
 * @param context - Request context.
 * @param info - Resolve info, for reading the invite back.
 * @returns The invite.
 * @throws NOT_FOUND unless the caller owns the group.
 */
async function inviteToGroup(
  _parent: unknown,
  args: { groupId: string; email: string },
  context: Context,
  info: GraphQLResolveInfo,
) {
  const ownerId = requireAuth(context);
  const email = parseOrThrow(inviteEmailSchema, args.email);
  const group = await loadOwnedGroup(context.db, args.groupId, ownerId);
  const expiresAt = new Date(Date.now() + GROUP_DEFAULTS.inviteTtlDays * MS_PER_DAY);
  const [invite] = await context.db
    .insert(groupInvites)
    .values({ groupId: group.id, email, expiresAt })
    .returning({ id: groupInvites.id, token: groupInvites.token });
  await sendEach(context.mailer, [inviteEmail(email, group.name, invite.token)]);
  return readRow(info, context, { table: 'groupInvites', where: { id: { eq: invite.id } } });
}

/**
 * Makes the caller a member of the invite's group and spends the invite, in one transaction.
 *
 * @param _parent - Unused.
 * @param args - The invite's token, from its link.
 * @param context - Request context.
 * @param info - Resolve info, for reading the membership back.
 * @returns The new membership.
 * @throws NOT_FOUND for a link that names no invite; BAD_USER_INPUT for a spent or expired one, or a caller who is
 * already a member (the link is left unspent for whoever it was meant for).
 */
async function acceptGroupInvite(
  _parent: unknown,
  args: { token: string },
  context: Context,
  info: GraphQLResolveInfo,
) {
  const userId = requireAuth(context);
  const membershipId = await context.db.transaction(async (tx) => {
    const [invite] = await tx.select().from(groupInvites).where(eq(groupInvites.token, args.token)).limit(1);
    if (invite === undefined) {
      throw notFound(INVITE_NOT_FOUND);
    }
    if (invite.acceptedAt !== null) {
      throw badInput(INVITE_USED);
    }
    if (invite.expiresAt < new Date()) {
      throw badInput('This invite link has expired. Ask the group owner for a new one.');
    }
    const isTheirs = and(eq(groupMembers.groupId, invite.groupId), eq(groupMembers.userId, userId));
    const [existing] = await tx.select({ id: groupMembers.id }).from(groupMembers).where(isTheirs).limit(1);
    if (existing !== undefined) {
      throw badInput("You're already a member of this group.");
    }
    // Only one acceptance can spend it, however many arrive at once.
    const isPending = and(eq(groupInvites.id, invite.id), isNull(groupInvites.acceptedAt));
    const spent = await tx.update(groupInvites).set({ acceptedAt: new Date() }).where(isPending).returning();
    if (spent.length === 0) {
      throw badInput(INVITE_USED);
    }
    const [membership] = await tx
      .insert(groupMembers)
      .values({ groupId: invite.groupId, userId })
      .returning({ id: groupMembers.id });
    return membership.id;
  });
  return readRow(info, context, { table: 'groupMembers', where: { id: { eq: membershipId } } });
}

/**
 * Deletes a pending invite to a group the caller owns. Its link then answers like one that never existed.
 *
 * @param _parent - Unused.
 * @param args - The invite.
 * @param context - Request context.
 * @param info - Resolve info, for reading the group back.
 * @returns The invite's group.
 * @throws NOT_FOUND unless it is a pending invite to a group the caller owns.
 */
async function cancelInvite(_parent: unknown, args: { id: string }, context: Context, info: GraphQLResolveInfo) {
  const ownerId = requireAuth(context);
  const ownedGroups = context.db.select({ id: groups.id }).from(groups).where(eq(groups.ownerId, ownerId));
  const isCancellable = and(
    eq(groupInvites.id, args.id),
    isNull(groupInvites.acceptedAt),
    inArray(groupInvites.groupId, ownedGroups),
  );
  const [cancelled] = await context.db
    .delete(groupInvites)
    .where(isCancellable)
    .returning({ groupId: groupInvites.groupId });
  if (cancelled === undefined) {
    throw notFound('Invite not found');
  }
  return readRow(info, context, { table: 'groups', where: { id: { eq: cancelled.groupId } } });
}

/**
 * Adds inviting, joining and cancelling. `group_invites` and `group_members` have no generated writes.
 *
 * @param schema - Schema to extend.
 * @returns The extended schema.
 */
export function applyInvitesExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, INVITES_SDL);
  const mutations = objectType(extended, 'Mutation').getFields();
  mutations.inviteToGroup.resolve = inviteToGroup;
  mutations.acceptGroupInvite.resolve = acceptGroupInvite;
  mutations.cancelInvite.resolve = cancelInvite;
  return extended;
}
