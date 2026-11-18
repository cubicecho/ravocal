import nodemailer from 'nodemailer';
import { smtpFrom, smtpUrl } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import type { MagicLink } from './better-auth.ts';

/** One outgoing email. The From address is always `smtpFrom()`. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Delivers one email. The context carries one, so tests capture what resolvers send. */
export type Mailer = (message: MailMessage) => Promise<void>;

/**
 * Sends one email through `SMTP_URL`. With it unset, the message is printed to the console instead.
 *
 * @remarks
 * Sign-in links never reach the console: better-auth only sends them when `SMTP_URL` is set (better-auth.ts).
 *
 * @param message - Who it is to, and what it says.
 * @returns Resolves once the SMTP server has accepted it, or once it is printed.
 */
export const sendMail: Mailer = async (message) => {
  const url = smtpUrl();
  const mail = { from: smtpFrom(), ...message };
  if (url === undefined) {
    console.log('[email]', mail);
    return;
  }
  await nodemailer.createTransport(url).sendMail(mail);
};

/**
 * Sends what a committed write announces. A message that fails is logged rather than thrown: the write has happened,
 * and the answer must say so.
 *
 * @param mailer - The request's mailer.
 * @param messages - The emails, sent one after another.
 * @returns Resolves once each was accepted or logged as failed.
 */
export async function sendEach(mailer: Mailer, messages: MailMessage[]): Promise<void> {
  for (const message of messages) {
    try {
      await mailer(message);
    } catch (error) {
      // The subject says which email, without the address it was for.
      console.error(`[email] could not send "${message.subject}": ${errorMessage(error)}`);
    }
  }
}

/**
 * Emails a sign-in link through `SMTP_URL`. Only wired up when it is set, so the link is never printed or logged.
 *
 * @param link - The address, and the link to send it.
 * @returns Resolves once the SMTP server has accepted the message.
 */
export async function sendMagicLinkEmail({ email, url }: MagicLink): Promise<void> {
  await sendMail({
    to: email,
    subject: 'Your Ravocal sign-in link',
    text: `Sign in to Ravocal:\n\n${url}\n\nThe link works once, for ${AUTH_DEFAULTS.magicLinkTtlMinutes} minutes. If you did not ask for it, ignore this email.`,
  });
}
