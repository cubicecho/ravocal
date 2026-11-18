import type { MailMessage } from '../auth/email.ts';
import { appUrl } from '../core/config.ts';

/** A winning slot as the result email says it: in UTC, since the server can't know each reader's zone. */
const WINDOW = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/**
 * Writes the emails that say a vote has opened.
 *
 * @param to - The members' addresses.
 * @param groupName - The group voting.
 * @param groupId - Its id, for the link to its page.
 * @returns One message per member.
 */
export function voteStartedEmails(to: string[], groupName: string, groupId: string): MailMessage[] {
  const link = `${appUrl()}/groups/${groupId}`;
  return to.map((address) => ({
    to: address,
    subject: `A vote has started in "${groupName}" on Ravocal`,
    text: `A ranked-choice vote on when "${groupName}" meets has started. Rank the times here:\n\n${link}`,
  }));
}

/**
 * Writes the emails that announce a vote's result.
 *
 * @param to - The members' addresses.
 * @param groupName - The group that voted.
 * @param winner - The winning slot, or null when nobody ranked any.
 * @returns One message per member.
 */
export function voteResultEmails(
  to: string[],
  groupName: string,
  winner: { startsAt: Date; endsAt: Date } | null,
): MailMessage[] {
  const result =
    winner === null
      ? 'No clear winner was determined.'
      : `The winning time is:\n${WINDOW.formatRange(winner.startsAt, winner.endsAt)} (UTC)`;
  return to.map((address) => ({
    to: address,
    subject: `Vote result for "${groupName}"`,
    text: `The vote for "${groupName}" has closed.\n\n${result}`,
  }));
}
