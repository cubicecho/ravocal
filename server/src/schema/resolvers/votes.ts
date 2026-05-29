import { and, eq } from "drizzle-orm";
import { groupMembers, groups, voteRankings, voteSlots, votes } from "@ravocal/db";
import { z } from "zod";
import type { Context } from "../../context.ts";
import { sendVoteStartedEmail, sendVoteResultEmail } from "../../services/email.ts";
import { computeVoteSlots, tallyRankedChoice } from "../../services/voting.ts";

const RankingInput = z.object({ slotId: z.string().uuid(), rank: z.number().int().min(1) });

export function applyVoteResolvers(
  _queryFields: Record<string, unknown>,
  mutationFields: Record<string, unknown>,
) {
  mutationFields.startVote = async (_: unknown, args: { groupId: string }, ctx: Context) => {
    if (!ctx.userId) throw new Error("Not authenticated");
    const group = await ctx.db.query.groups.findFirst({
      where: eq(groups.id, args.groupId),
      with: { members: true, timeBlocks: true },
    });
    if (!group) throw new Error(`Group ${args.groupId} not found`);
    if (group.ownerId !== ctx.userId) throw new Error("Forbidden");

    const slots = computeVoteSlots(group.members, group.timeBlocks, group.overlapThreshold, false);
    if (slots.length === 0) {
      throw new Error(
        `No slots meet the overlap threshold of ${group.overlapThreshold}%. Use forceStartVote to override.`,
      );
    }
    return createVote(ctx, args.groupId, group, slots, false);
  };

  mutationFields.forceStartVote = async (
    _: unknown,
    args: { groupId: string },
    ctx: Context,
  ) => {
    if (!ctx.userId) throw new Error("Not authenticated");
    const group = await ctx.db.query.groups.findFirst({
      where: eq(groups.id, args.groupId),
      with: { members: true, timeBlocks: true },
    });
    if (!group) throw new Error(`Group ${args.groupId} not found`);
    if (group.ownerId !== ctx.userId) throw new Error("Forbidden");

    const slots = computeVoteSlots(group.members, group.timeBlocks, 0, true);
    if (slots.length === 0) throw new Error("No time blocks have been submitted yet.");
    return createVote(ctx, args.groupId, group, slots, true);
  };

  mutationFields.submitRankings = async (
    _: unknown,
    args: { voteId: string; rankings: Array<{ slotId: string; rank: number }> },
    ctx: Context,
  ) => {
    if (!ctx.userId) throw new Error("Not authenticated");
    const inputs = z.array(RankingInput).parse(args.rankings);

    const vote = await ctx.db.query.votes.findFirst({ where: eq(votes.id, args.voteId) });
    if (!vote) throw new Error(`Vote ${args.voteId} not found`);
    if (vote.status !== "active") throw new Error("Vote is not active");

    const membership = await ctx.db.query.groupMembers.findFirst({
      where: and(
        eq(groupMembers.groupId, vote.groupId),
        eq(groupMembers.userId, ctx.userId),
      ),
    });
    if (!membership) throw new Error("Forbidden");

    await ctx.db
      .delete(voteRankings)
      .where(
        and(eq(voteRankings.voteId, args.voteId), eq(voteRankings.userId, ctx.userId)),
      );

    const rows = inputs.map((r) => ({
      voteId: args.voteId,
      userId: ctx.userId as string,
      slotId: r.slotId,
      rank: r.rank,
    }));
    return ctx.db.insert(voteRankings).values(rows).returning();
  };

  mutationFields.closeVote = async (
    _: unknown,
    args: { voteId: string },
    ctx: Context,
  ) => {
    if (!ctx.userId) throw new Error("Not authenticated");
    const vote = await ctx.db.query.votes.findFirst({
      where: eq(votes.id, args.voteId),
      with: { slots: true, rankings: true },
    });
    if (!vote) throw new Error(`Vote ${args.voteId} not found`);
    if (vote.status !== "active") throw new Error("Vote is not active");

    const group = await ctx.db.query.groups.findFirst({
      where: eq(groups.id, vote.groupId),
      with: { members: { with: { user: true } } },
    });
    if (!group) throw new Error("Group not found");
    if (group.ownerId !== ctx.userId) throw new Error("Forbidden");

    const winnerSlotId = tallyRankedChoice(vote.slots, vote.rankings);
    const [closed] = await ctx.db
      .update(votes)
      .set({ status: "closed", winnerSlotId, closedAt: new Date() })
      .where(eq(votes.id, args.voteId))
      .returning();

    const winner = vote.slots.find((s: { id: string }) => s.id === winnerSlotId);
    const emails = group.members.map((m: { user: { email: string } }) => m.user.email);
    await sendVoteResultEmail(emails, group.name, winner ?? null);

    return closed;
  };
}

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
