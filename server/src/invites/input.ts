import { z } from 'zod';
import { GROUP_DEFAULTS } from '../core/defaults.ts';

const { maxInviteEmailLength } = GROUP_DEFAULTS;

/** Where an invite link is emailed. Lower-cased and trimmed, as sign-in stores addresses. */
export const inviteEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(maxInviteEmailLength, `Keep the address to ${maxInviteEmailLength} characters or fewer.`)
  .pipe(z.email('Enter a valid email address.'));
