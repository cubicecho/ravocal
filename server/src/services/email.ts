import type { VoteSlot } from '@cubicecho/ravocal-db/schema';
import nodemailer from 'nodemailer';
import { appUrl, emailFrom, smtpHost, smtpPass, smtpPort, smtpUser } from '../core/config.ts';
import { AUTH_DEFAULTS, GROUP_DEFAULTS } from '../core/defaults.ts';

/** One outgoing email. */
interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** What the senders below need from a transport: nodemailer's, or the dev logger. */
interface MailTransport {
  sendMail: (message: MailMessage) => Promise<unknown>;
}

/**
 * Picks the mail transport: SMTP when `SMTP_HOST` is set, otherwise a
 * logger that prints each message to the console.
 *
 * @returns The transport to send with.
 */
function createTransport(): MailTransport {
  const host = smtpHost();
  if (host !== undefined) {
    const user = smtpUser();
    return nodemailer.createTransport({
      host,
      port: smtpPort(),
      auth: user === undefined ? undefined : { user, pass: smtpPass() },
    });
  }
  // Dev: log to console instead of sending
  return {
    sendMail: async (opts: MailMessage) => {
      console.log('[email]', opts);
    },
  };
}

export async function sendMagicLinkEmail(to: string, link: string): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: emailFrom(),
    to,
    subject: 'Your Ravocal sign-in link',
    text: `Click to sign in (expires in ${AUTH_DEFAULTS.magicLinkTtlMinutes} minutes):\n\n${link}`,
  });
}

export async function sendGroupInviteEmail(to: string, groupName: string, token: string): Promise<void> {
  const link = `${appUrl()}/invite?token=${token}`;
  const transport = createTransport();
  await transport.sendMail({
    from: emailFrom(),
    to,
    subject: `You've been invited to "${groupName}" on Ravocal`,
    text: `You've been invited to join "${groupName}" on Ravocal.\n\nAccept your invite:\n\n${link}\n\nThis link expires in ${GROUP_DEFAULTS.inviteTtlDays} days.`,
  });
}

export async function sendVoteStartedEmail(to: string[], groupId: string): Promise<void> {
  const link = `${appUrl()}/groups/${groupId}`;
  const transport = createTransport();
  for (const email of to) {
    await transport.sendMail({
      from: emailFrom(),
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
  const transport = createTransport();
  for (const email of to) {
    await transport.sendMail({
      from: emailFrom(),
      to: email,
      subject: `Vote result for "${groupName}"`,
      text: `The vote for "${groupName}" has closed.\n\n${winnerText}`,
    });
  }
}
