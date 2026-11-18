import { voteRankings, voteSlots, votes } from '@cubicecho/ravocal-db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../../core/context.ts';
import { badInput, forbidden, notFound, requireAuth } from '../../core/errors.ts';
import { parseOrThrow } from '../../core/validation.ts';
import { sendVoteResultEmail, sendVoteStartedEmail } from '../../services/email.ts';
import { computeVoteSlots, tallyRankedChoice } from '../../services/voting.ts';

const RankingInput = z.object({
  slotId: z.uuid('That is not a valid slot id.'),
  rank: z.number().int('Ranks are whole numbers.').min(1, 'Ranks start at 1.'),
});

export function applyVoteResolvers(_queryFields: Record<string, unknown>, mutationFields: Record<string, unknown>) {
  mutationFields.startVote = async (_: unknown, args: { groupId: string }, ctx: Context) => {
    const userId = requireAuth(ctx);
    const group = await ctx.db.query.groups.findFirst({
      where: { id: args.groupId },
      with: { members: { with: { user: true } }, timeBlocks: true },
    });
    if (!group) {
      throw notFound(`Group ${args.groupId} not found`);
    }
    if (group.ownerId !== userId) {
      throw forbidden('Forbidden');
    }

    const slots = computeVoteSlots(group.members, group.timeBlocks, group.overlapThreshold, false);
    if (slots.length === 0) {
      throw badInput(
        `No slots meet the overlap threshold of ${group.overlapThreshold}%. Use forceStartVote to override.`,
      );
    }
    return createVote(ctx, args.groupId, group, slots, false);
  };

  mutationFields.forceStartVote = async (_: unknown, args: { groupId: string }, ctx: Context) => {
    const userId = requireAuth(ctx);
    const group = await ctx.db.query.groups.findFirst({
      where: { id: args.groupId },
      with: { members: { with: { user: true } }, timeBlocks: true },
    });
    if (!group) {
      throw notFound(`Group ${args.groupId} not found`);
    }
    if (group.ownerId !== userId) {
      throw forbidden('Forbidden');
    }

    const slots = computeVoteSlots(group.members, group.timeBlocks, 0, true, group.ownerId);
    if (slots.length === 0) {
      throw badInput('No time blocks have been submitted yet.');
    }
    return createVote(ctx, args.groupId, group, slots, true);
  };

  mutationFields.submitRankings = async (
    _: unknown,
    args: { voteId: string; rankings: Array<{ slotId: string; rank: number }> },
    ctx: Context,
  ) => {
    const userId = requireAuth(ctx);
    const inputs = parseOrThrow(z.array(RankingInput), args.rankings);

    const vote = await ctx.db.query.votes.findFirst({ where: { id: args.voteId } });
    if (!vote) {
      throw notFound(`Vote ${args.voteId} not found`);
    }
    if (vote.status !== 'active') {
      throw badInput('Vote is not active');
    }

    const membership = await ctx.db.query.groupMembers.findFirst({
      where: { groupId: vote.groupId, userId },
    });
    if (!membership) {
      throw forbidden('Forbidden');
    }

    await ctx.db.delete(voteRankings).where(and(eq(voteRankings.voteId, args.voteId), eq(voteRankings.userId, userId)));

    const rows = inputs.map((r) => ({
      voteId: args.voteId,
      userId,
      slotId: r.slotId,
      rank: r.rank,
    }));
    return ctx.db.insert(voteRankings).values(rows).returning();
  };

  mutationFields.closeVote = async (_: unknown, args: { voteId: string }, ctx: Context) => {
    const userId = requireAuth(ctx);
    const vote = await ctx.db.query.votes.findFirst({
      where: { id: args.voteId },
      with: { slots: true, rankings: true },
    });
    if (!vote) {
      throw notFound(`Vote ${args.voteId} not found`);
    }
    if (vote.status !== 'active') {
      throw badInput('Vote is not active');
    }

    const group = await ctx.db.query.groups.findFirst({
      where: { id: vote.groupId },
      with: { members: { with: { user: true } } },
    });
    if (!group) {
      throw notFound('Group not found');
    }
    if (group.ownerId !== userId) {
      throw forbidden('Forbidden');
    }

    const winnerSlotId = tallyRankedChoice(vote.slots, vote.rankings);
    const [closed] = await ctx.db
      .update(votes)
      .set({ status: 'closed', winnerSlotId, closedAt: new Date() })
      .where(eq(votes.id, args.voteId))
      .returning();

    const winner = vote.slots.find((s) => s.id === winnerSlotId);
    const emails = group.members.map((m) => m.user.email);
    await sendVoteResultEmail(emails, group.name, winner ?? null);

    return closed;
  };
}

/**
 * Vote's derived fields. The resolvers above return bare vote rows, and the
 * group query's activeVote is one too, so slots and rankings load here.
 */
export const voteFields = {
  // Insertion order, which is computeVoteSlots' order (owner-free first in a forced vote).
  slots: (vote: { id: string }, _: unknown, ctx: Context) =>
    ctx.db.query.voteSlots.findMany({ where: { voteId: vote.id } }),
  myRankings: (vote: { id: string }, _: unknown, ctx: Context) => {
    if (!ctx.userId) {
      return [];
    }
    return ctx.db.query.voteRankings.findMany({
      where: { voteId: vote.id, userId: ctx.userId },
    });
  },
};

async function createVote(
  ctx: Context,
  groupId: string,
  group: { members: Array<{ user: { email: string } }> },
  slots: Array<{ startsAt: Date; endsAt: Date; overlapCount: number }>,
  isForced: boolean,
) {
  const [vote] = await ctx.db.insert(votes).values({ groupId, isForced }).returning();
  await ctx.db.insert(voteSlots).values(slots.map((s) => ({ ...s, voteId: vote.id })));
  const emails = group.members.map((m) => m.user.email);
  await sendVoteStartedEmail(emails, groupId);
  return vote;
}
