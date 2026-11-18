import {
  type Group,
  groupMembers,
  timeBlocks,
  users,
  VOTE_ACTIVE,
  VOTE_CLOSED,
  type Vote,
  voteRankings,
  voteSlots,
  votes,
} from '@cubicecho/ravocal-db/schema';
import { and, eq } from 'drizzle-orm';
import { extendSchema, type GraphQLResolveInfo, type GraphQLSchema, parse } from 'graphql';
import { sendEach } from '../auth/email.ts';
import type { Context } from '../core/context.ts';
import { badInput, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { objectType } from '../graphql/object-type.ts';
import { readRow, readRows } from '../graphql/read-back.ts';
import type { Executor } from '../graphql/write-guards.ts';
import { type GroupLoader, loadMemberGroup, loadOwnedGroup } from '../groups/access.ts';
import { voteResultEmails, voteStartedEmails } from './email.ts';
import { rankingsInput } from './input.ts';
import { computeVoteSlots, tallyRankedChoice } from './tally.ts';

// Votes, their slots and their rankings have no generated writes: each change here follows a rule the tables can't
// state (who may start one, which slots it gets, when a ballot may change), so all of them are hand-written.

const VOTES_SDL = parse(`
  "One place on a ballot."
  input RankingInput {
    "A candidate slot of the vote."
    slotId: UUID!
    "1 for the top choice."
    rank: Int!
  }

  extend type Mutation {
    "Opens a vote in a group you own, over the times enough members are free for (its overlap threshold). Fails when none are: forceStartVote is the way past it."
    startVote(groupId: UUID!): Vote!
    "Opens a vote over every time anyone is free for, the ones you are free for first. For when no time meets the threshold."
    forceStartVote(groupId: UUID!): Vote!
    "Replaces your ballot in an open vote of a group you are in. An empty list withdraws it."
    submitRankings(voteId: UUID!, rankings: [RankingInput!]!): [VoteRanking!]!
    "Closes an open vote in a group you own, and settles its winner by instant runoff."
    closeVote(voteId: UUID!): Vote!
  }
`);

/** What a vote the caller can't reach, or can't run, is told. */
const VOTE_NOT_FOUND = 'Vote not found';

/**
 * Reads a vote back as `Vote`, with whatever the caller selected under it.
 *
 * @param info - The mutation's resolve info.
 * @param context - Request context.
 * @param id - The vote.
 * @returns The vote.
 */
const readVote = (info: GraphQLResolveInfo, context: Context, id: string) =>
  readRow(info, context, { table: 'votes', where: { id: { eq: id } } });

/**
 * Lists a group's members' addresses, for the emails a vote sends.
 *
 * @param executor - The db.
 * @param groupId - The group.
 * @returns One address per member.
 */
async function memberEmails(executor: Executor, groupId: string): Promise<string[]> {
  const rows = await executor
    .select({ email: users.email })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((row) => row.email);
}

/**
 * Loads a vote whose group the caller may act on.
 *
 * @param executor - The db, or the transaction the caller is writing in.
 * @param voteId - The vote.
 * @param userId - The caller.
 * @param loadGroup - `loadMemberGroup` when a member will do, `loadOwnedGroup` when only the owner may.
 * @returns The vote and its group.
 * @throws NOT_FOUND when the vote is missing or out of the caller's reach.
 */
async function loadVote(
  executor: Executor,
  voteId: string,
  userId: string,
  loadGroup: GroupLoader,
): Promise<{ vote: Vote; group: Group }> {
  const [vote] = await executor.select().from(votes).where(eq(votes.id, voteId)).limit(1);
  if (vote === undefined) {
    throw notFound(VOTE_NOT_FOUND);
  }
  return { vote, group: await loadGroup(executor, vote.groupId, userId, VOTE_NOT_FOUND) };
}

/**
 * Refuses a vote that is already closed.
 *
 * @param vote - The vote.
 * @throws BAD_USER_INPUT when it is closed.
 */
function assertOpen(vote: Vote): void {
  if (vote.status !== VOTE_ACTIVE) {
    throw badInput('This vote has closed.');
  }
}

/**
 * Opens a vote over the given candidates, storing each slot's ballot position, then emails the members.
 *
 * @param context - Request context.
 * @param info - Resolve info, for reading the vote back.
 * @param groupId - The owner's group.
 * @param isForced - Whether the owner went past the threshold.
 * @returns The vote.
 * @throws NOT_FOUND unless the caller owns the group; BAD_USER_INPUT while another vote is open, or with no slots.
 */
async function openVote(context: Context, info: GraphQLResolveInfo, groupId: string, isForced: boolean) {
  const ownerId = requireAuth(context);
  const { voteId, group } = await context.db.transaction(async (tx) => {
    const owned = await loadOwnedGroup(tx, groupId, ownerId);
    const isOpen = and(eq(votes.groupId, groupId), eq(votes.status, VOTE_ACTIVE));
    const [open] = await tx.select({ id: votes.id }).from(votes).where(isOpen).limit(1);
    if (open !== undefined) {
      throw badInput('This group already has an open vote. Close it before starting another.');
    }
    const members = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    const blocks = await tx.select().from(timeBlocks).where(eq(timeBlocks.groupId, groupId));
    // A forced vote takes every slot anyone is free for, and puts the owner's first.
    const threshold = isForced ? 0 : owned.overlapThreshold;
    const candidates = computeVoteSlots(members, blocks, threshold, isForced, owned.ownerId);
    if (candidates.length === 0) {
      const advice = isForced
        ? 'Nobody has added free time yet.'
        : `No time has ${owned.overlapThreshold}% of the group free. Use forceStartVote to open one anyway.`;
      throw badInput(advice);
    }
    const [vote] = await tx.insert(votes).values({ groupId, isForced }).returning({ id: votes.id });
    const slots = candidates.map((candidate, position) => ({ ...candidate, voteId: vote.id, position }));
    await tx.insert(voteSlots).values(slots);
    return { voteId: vote.id, group: owned };
  });
  await sendEach(context.mailer, voteStartedEmails(await memberEmails(context.db, groupId), group.name, groupId));
  return readVote(info, context, voteId);
}

/**
 * Replaces the caller's ballot in an open vote.
 *
 * @param _parent - Unused.
 * @param args - The vote, and the ballot.
 * @param context - Request context.
 * @param info - Resolve info, for reading the ballot back.
 * @returns The caller's rankings, now.
 * @throws NOT_FOUND unless the caller is in the vote's group; BAD_USER_INPUT for a closed vote or a foreign slot.
 */
async function submitRankings(
  _parent: unknown,
  args: { voteId: string; rankings: Array<{ slotId: string; rank: number }> },
  context: Context,
  info: GraphQLResolveInfo,
) {
  const userId = requireAuth(context);
  const rankings = parseOrThrow(rankingsInput, args.rankings);
  await context.db.transaction(async (tx) => {
    const { vote } = await loadVote(tx, args.voteId, userId, loadMemberGroup);
    assertOpen(vote);
    const slots = await tx.select({ id: voteSlots.id }).from(voteSlots).where(eq(voteSlots.voteId, vote.id));
    const candidates = new Set(slots.map((slot) => slot.id));
    const isForeign = rankings.some((ranking) => candidates.has(ranking.slotId) === false);
    if (isForeign) {
      throw badInput('Rank only the candidate times of this vote.');
    }
    const isCallers = and(eq(voteRankings.voteId, vote.id), eq(voteRankings.userId, userId));
    await tx.delete(voteRankings).where(isCallers);
    if (rankings.length > 0) {
      await tx.insert(voteRankings).values(rankings.map((ranking) => ({ ...ranking, voteId: vote.id, userId })));
    }
  });
  return readRows(info, context, { table: 'voteRankings', where: { voteId: { eq: args.voteId } } });
}

/**
 * Closes an open vote with its instant-runoff winner, then emails the members the result.
 *
 * @param _parent - Unused.
 * @param args - The vote.
 * @param context - Request context.
 * @param info - Resolve info, for reading the vote back.
 * @returns The closed vote.
 * @throws NOT_FOUND unless the caller owns the vote's group; BAD_USER_INPUT for a vote already closed.
 */
async function closeVote(_parent: unknown, args: { voteId: string }, context: Context, info: GraphQLResolveInfo) {
  const ownerId = requireAuth(context);
  const { group, winner } = await context.db.transaction(async (tx) => {
    const loaded = await loadVote(tx, args.voteId, ownerId, loadOwnedGroup);
    assertOpen(loaded.vote);
    const slots = await tx.select().from(voteSlots).where(eq(voteSlots.voteId, args.voteId));
    const ballots = await tx.select().from(voteRankings).where(eq(voteRankings.voteId, args.voteId));
    const winnerSlotId = tallyRankedChoice(slots, ballots);
    await tx
      .update(votes)
      .set({ status: VOTE_CLOSED, winnerSlotId, closedAt: new Date() })
      .where(eq(votes.id, args.voteId));
    return { group: loaded.group, winner: slots.find((slot) => slot.id === winnerSlotId) ?? null };
  });
  await sendEach(context.mailer, voteResultEmails(await memberEmails(context.db, group.id), group.name, winner));
  return readVote(info, context, args.voteId);
}

/**
 * Adds starting, ranking and closing a vote.
 *
 * @param schema - Schema to extend.
 * @returns The extended schema.
 */
export function applyVotesExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, VOTES_SDL);
  const mutations = objectType(extended, 'Mutation').getFields();
  mutations.startVote.resolve = (_parent: unknown, args: { groupId: string }, context: Context, info) =>
    openVote(context, info, args.groupId, false);
  mutations.forceStartVote.resolve = (_parent: unknown, args: { groupId: string }, context: Context, info) =>
    openVote(context, info, args.groupId, true);
  mutations.submitRankings.resolve = submitRankings;
  mutations.closeVote.resolve = closeVote;
  return extended;
}
