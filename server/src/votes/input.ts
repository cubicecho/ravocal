import { z } from 'zod';

/** One member's ballot: each candidate at most once, 1 for the top choice. */
export const rankingsInput = z
  .array(
    z.object({
      slotId: z.uuid('That is not a valid slot id.'),
      rank: z.number().int('Ranks are whole numbers.').min(1, 'Ranks start at 1.'),
    }),
  )
  .refine((rankings) => new Set(rankings.map((ranking) => ranking.slotId)).size === rankings.length, {
    message: 'Rank each candidate time once.',
  });
