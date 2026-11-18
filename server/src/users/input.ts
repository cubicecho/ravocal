import { z } from 'zod';
import { USER_DEFAULTS } from '../core/defaults.ts';

const { maxNameLength } = USER_DEFAULTS;

/** The columns `updateUser` may change. Partial, since its `set` carries only those it changes. */
export const userInput = z
  .object({
    // Not trimmed: a hook can refuse a value but not rewrite it.
    name: z
      .string()
      .max(maxNameLength, `Keep your name to ${maxNameLength} characters or fewer.`)
      .refine((name) => name.trim() !== '', 'Your name cannot be empty.'),
  })
  .partial();
