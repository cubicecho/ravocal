import { z } from 'zod';
import { GROUP_DEFAULTS } from '../core/defaults.ts';
import { PERCENT } from '../core/wire.ts';

const { maxNameLength } = GROUP_DEFAULTS;
const THRESHOLD_RANGE = `The overlap threshold must be a whole number from 0 to ${PERCENT}.`;

// Not trimmed: a hook can refuse a value but not rewrite it, so the rule has to hold for the value as sent.
export const groupNameSchema = z
  .string()
  .max(maxNameLength, `Keep the group name to ${maxNameLength} characters or fewer.`)
  .refine((name) => name.trim() !== '', 'Give the group a name.');

export const overlapThresholdSchema = z
  .number()
  .int(THRESHOLD_RANGE)
  .min(0, THRESHOLD_RANGE)
  .max(PERCENT, THRESHOLD_RANGE);

/** A new group. Left out, the threshold takes the column's default. */
export const createGroupInput = z.object({
  name: groupNameSchema,
  overlapThreshold: overlapThresholdSchema.optional(),
});

/** The columns `updateGroup` may change. Partial, since its `set` carries only those it changes. */
export const groupInput = createGroupInput.partial();
