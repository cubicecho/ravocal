import { and, eq } from "drizzle-orm";
import { groupMembers, timeBlocks } from "@ravocal/db";
import { z } from "zod";
import type { Context } from "../../context.ts";

const AddTimeBlockInput = z.object({
  groupId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).refine(
  (d) => {
    const start = new Date(d.startsAt);
    const end = new Date(d.endsAt);
    const diffMs = end.getTime() - start.getTime();
    const thirtyMin = 30 * 60 * 1000;
    return (
      diffMs >= thirtyMin &&
      start.getMinutes() % 30 === 0 &&
      end.getMinutes() % 30 === 0
    );
  },
  { message: "Time blocks must be 30-minute aligned and at least 30 minutes long" },
);

export function applyTimeBlockResolvers(
  _queryFields: Record<string, unknown>,
  mutationFields: Record<string, unknown>,
) {
  mutationFields.addTimeBlock = async (
    _: unknown,
    args: { groupId: string; startsAt: string; endsAt: string },
    ctx: Context,
  ) => {
    if (!ctx.userId) throw new Error("Not authenticated");
    const input = AddTimeBlockInput.parse(args);

    const membership = await ctx.db.query.groupMembers.findFirst({
      where: and(
        eq(groupMembers.groupId, input.groupId),
        eq(groupMembers.userId, ctx.userId),
      ),
    });
    if (!membership) throw new Error("Forbidden");

    const [block] = await ctx.db
      .insert(timeBlocks)
      .values({
        groupId: input.groupId,
        userId: ctx.userId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      })
      .returning();
    return block;
  };

  mutationFields.removeTimeBlock = async (
    _: unknown,
    args: { id: string },
    ctx: Context,
  ) => {
    if (!ctx.userId) throw new Error("Not authenticated");
    const block = await ctx.db.query.timeBlocks.findFirst({
      where: eq(timeBlocks.id, args.id),
    });
    if (!block) throw new Error(`TimeBlock ${args.id} not found`);
    if (block.userId !== ctx.userId) throw new Error("Forbidden");
    await ctx.db.delete(timeBlocks).where(eq(timeBlocks.id, args.id));
    return true;
  };
}
