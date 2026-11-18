import { timeBlocks } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../../context.ts';
import { SCHEDULE_DEFAULTS } from '../../core/defaults.ts';
import { forbidden, notFound, requireAuth } from '../../core/errors.ts';
import { MS_PER_MINUTE } from '../../core/wire.ts';

const { slotMinutes } = SCHEDULE_DEFAULTS;

const AddTimeBlockInput = z
  .object({
    groupId: z.string().uuid(),
    // The DateTime scalar has already parsed these into Dates by the time a resolver sees them.
    startsAt: z.date(),
    endsAt: z.date(),
  })
  .refine(
    (d) => {
      const start = new Date(d.startsAt);
      const end = new Date(d.endsAt);
      const diffMs = end.getTime() - start.getTime();
      const slotMs = slotMinutes * MS_PER_MINUTE;
      return diffMs >= slotMs && start.getMinutes() % slotMinutes === 0 && end.getMinutes() % slotMinutes === 0;
    },
    { message: 'Time blocks must be 30-minute aligned and at least 30 minutes long' },
  );

export function applyTimeBlockResolvers(
  _queryFields: Record<string, unknown>,
  mutationFields: Record<string, unknown>,
) {
  mutationFields.addTimeBlock = async (
    _: unknown,
    args: { groupId: string; startsAt: Date; endsAt: Date },
    ctx: Context,
  ) => {
    const userId = requireAuth(ctx);
    const input = AddTimeBlockInput.parse(args);

    const membership = await ctx.db.query.groupMembers.findFirst({
      where: { groupId: input.groupId, userId },
    });
    if (!membership) {
      throw forbidden('Forbidden');
    }

    const [block] = await ctx.db
      .insert(timeBlocks)
      .values({
        groupId: input.groupId,
        userId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      })
      .returning();
    return block;
  };

  mutationFields.removeTimeBlock = async (_: unknown, args: { id: string }, ctx: Context) => {
    const userId = requireAuth(ctx);
    const block = await ctx.db.query.timeBlocks.findFirst({
      where: { id: args.id },
    });
    if (!block) {
      throw notFound(`TimeBlock ${args.id} not found`);
    }
    if (block.userId !== userId) {
      throw forbidden('Forbidden');
    }
    await ctx.db.delete(timeBlocks).where(eq(timeBlocks.id, args.id));
    return true;
  };
}
