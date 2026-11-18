import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { sendMail } from '../services/email.ts';
import type { MagicLink } from './better-auth.ts';

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
