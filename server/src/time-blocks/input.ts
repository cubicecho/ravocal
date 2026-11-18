import { z } from 'zod';
import { SCHEDULE_DEFAULTS } from '../core/defaults.ts';
import { MS_PER_MINUTE } from '../core/wire.ts';

const { slotMinutes } = SCHEDULE_DEFAULTS;
const SLOT_MS = slotMinutes * MS_PER_MINUTE;

/**
 * Whether an instant falls on the slot grid. Counted in UTC, from the epoch: a reader's own clock decides nothing.
 *
 * @param at - The instant.
 * @returns true on a whole slot, to the millisecond.
 */
const isOnGrid = (at: Date): boolean => at.getTime() % SLOT_MS === 0;

/** A time block as written: both ends on the grid, the end after the start. */
export const timeWindowSchema = z
  .object({ startsAt: z.date(), endsAt: z.date() })
  .refine(
    ({ startsAt, endsAt }) => isOnGrid(startsAt) && isOnGrid(endsAt),
    `A time block starts and ends on a ${slotMinutes}-minute boundary in UTC (:00 or :30).`,
  )
  .refine(({ startsAt, endsAt }) => endsAt > startsAt, 'A time block ends after it starts.');
