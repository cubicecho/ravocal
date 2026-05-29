import nodemailer from "nodemailer";
import type { VoteSlot } from "@ravocal/db";

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  // Dev: log to console instead of sending
  return {
    sendMail: async (opts: { to: string; subject: string; text: string }) => {
      console.log("[email]", opts);
    },
  };
}

const from = process.env.EMAIL_FROM ?? "noreply@localhost";

export async function sendMagicLinkEmail(to: string, link: string): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from,
    to,
    subject: "Your Ravocal sign-in link",
    text: `Click to sign in (expires in 15 minutes):\n\n${link}`,
  } as Parameters<typeof transport.sendMail>[0]);
}

export async function sendGroupInviteEmail(
  to: string,
  groupName: string,
  token: string,
): Promise<void> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3001";
  const link = `${appUrl}/invite?token=${token}`;
  const transport = createTransport();
  await transport.sendMail({
    from,
    to,
    subject: `You've been invited to "${groupName}" on Ravocal`,
    text: `You've been invited to join "${groupName}" on Ravocal.\n\nAccept your invite:\n\n${link}\n\nThis link expires in 7 days.`,
  } as Parameters<typeof transport.sendMail>[0]);
}

export async function sendVoteStartedEmail(to: string[], groupId: string): Promise<void> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3001";
  const link = `${appUrl}/groups/${groupId}`;
  const transport = createTransport();
  for (const email of to) {
    await transport.sendMail({
      from,
      to: email,
      subject: "A vote has started in your Ravocal group",
      text: `A ranked-choice vote has started. Cast your vote here:\n\n${link}`,
    } as Parameters<typeof transport.sendMail>[0]);
  }
}

export async function sendVoteResultEmail(
  to: string[],
  groupName: string,
  winner: Pick<VoteSlot, "startsAt" | "endsAt"> | null,
): Promise<void> {
  const winnerText = winner
    ? `The winning time slot is:\n${winner.startsAt.toLocaleString()} – ${winner.endsAt.toLocaleString()}`
    : "No clear winner was determined.";
  const transport = createTransport();
  for (const email of to) {
    await transport.sendMail({
      from,
      to: email,
      subject: `Vote result for "${groupName}"`,
      text: `The vote for "${groupName}" has closed.\n\n${winnerText}`,
    } as Parameters<typeof transport.sendMail>[0]);
  }
}
