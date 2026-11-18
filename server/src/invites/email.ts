import type { MailMessage } from '../auth/email.ts';
import { appUrl } from '../core/config.ts';
import { GROUP_DEFAULTS } from '../core/defaults.ts';

/** The app page an invite link opens. */
export const INVITE_PATH = '/invite';

/**
 * Writes the email that carries an invite's link.
 *
 * @param to - Where it goes.
 * @param groupName - The group it joins.
 * @param token - The invite's secret: whoever opens the link while signed in joins.
 * @returns The message.
 */
export function inviteEmail(to: string, groupName: string, token: string): MailMessage {
  const link = `${appUrl()}${INVITE_PATH}?token=${token}`;
  return {
    to,
    subject: `You've been invited to "${groupName}" on Ravocal`,
    text: `You've been invited to join "${groupName}" on Ravocal.\n\nOpen this link to join:\n\n${link}\n\nIt works once, for ${GROUP_DEFAULTS.inviteTtlDays} days. Anyone who opens it can join, so don't pass it on.`,
  };
}
