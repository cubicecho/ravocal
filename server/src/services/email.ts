import type { VoteSlot } from '@cubicecho/ravocal-db/schema';
import nodemailer from 'nodemailer';
import { appUrl, smtpFrom, smtpUrl } from '../core/config.ts';
import { GROUP_DEFAULTS } from '../core/defaults.ts';

/** One outgoing email. The From address is always `smtpFrom()`. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends one email through `SMTP_URL`. With it unset, the message is printed to the console instead.
 *
 * @remarks
 * Sign-in links never reach the console: better-auth only sends them when `SMTP_URL` is set (auth/better-auth.ts).
 *
 * @param message - Who it is to, and what it says.
 * @returns Resolves once the SMTP server has accepted it, or once it is printed.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const url = smtpUrl();
  const mail = { from: smtpFrom(), ...message };
  if (url === undefined) {
    console.log('[email]', mail);
    return;
  }
  await nodemailer.createTransport(url).sendMail(mail);
}

export async function sendGroupInviteEmail(to: string, groupName: string, token: string): Promise<void> {
  const link = `${appUrl()}/invite?token=${token}`;
  await sendMail({
    to,
    subject: `You've been invited to "${groupName}" on Ravocal`,
    text: `You've been invited to join "${groupName}" on Ravocal.\n\nAccept your invite:\n\n${link}\n\nThis link expires in ${GROUP_DEFAULTS.inviteTtlDays} days.`,
  });
}

export async function sendVoteStartedEmail(to: string[], groupId: string): Promise<void> {
  const link = `${appUrl()}/groups/${groupId}`;
  for (const email of to) {
    await sendMail({
      to: email,
      subject: 'A vote has started in your Ravocal group',
      text: `A ranked-choice vote has started. Cast your vote here:\n\n${link}`,
    });
  }
}

export async function sendVoteResultEmail(
  to: string[],
  groupName: string,
  winner: Pick<VoteSlot, 'startsAt' | 'endsAt'> | null,
): Promise<void> {
  const winnerText = winner
    ? `The winning time slot is:\n${winner.startsAt.toLocaleString()} – ${winner.endsAt.toLocaleString()}`
    : 'No clear winner was determined.';
  for (const email of to) {
    await sendMail({
      to: email,
      subject: `Vote result for "${groupName}"`,
      text: `The vote for "${groupName}" has closed.\n\n${winnerText}`,
    });
  }
}
