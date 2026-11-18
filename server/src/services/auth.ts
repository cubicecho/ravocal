import { randomBytes } from 'node:crypto';
import type { DB } from '@cubicecho/ravocal-db';
import { magicLinks, users } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { appUrl, jwtSecret } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { MS_PER_MINUTE } from '../core/wire.ts';
import { sendMagicLinkEmail } from './email.ts';

export function randomToken(): string {
  return randomBytes(AUTH_DEFAULTS.tokenBytes).toString('hex');
}

export async function requestMagicLink(email: string, db: DB): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  let user = await db.query.users.findFirst({ where: { email: normalizedEmail } });
  if (!user) {
    [user] = await db.insert(users).values({ email: normalizedEmail }).returning();
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + AUTH_DEFAULTS.magicLinkTtlMinutes * MS_PER_MINUTE);
  await db.insert(magicLinks).values({ userId: user.id, token, expiresAt });

  const link = `${appUrl()}/login/verify?token=${token}`;
  await sendMagicLinkEmail(normalizedEmail, link);
}

export async function verifyMagicLink(
  token: string,
  db: DB,
): Promise<{
  token: string;
  user: { id: string; email: string; name: string | null; createdAt: string };
}> {
  const link = await db.query.magicLinks.findFirst({
    where: { token },
    with: { user: true },
  });
  if (!link) {
    throw new Error('Invalid or expired magic link');
  }
  if (link.usedAt) {
    throw new Error('Magic link already used');
  }
  if (link.expiresAt < new Date()) {
    throw new Error('Magic link expired');
  }

  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id));

  const secret = new TextEncoder().encode(jwtSecret());
  const jwt = await new SignJWT({ sub: link.user.id, email: link.user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${AUTH_DEFAULTS.sessionTtlDays}d`)
    .sign(secret);

  return {
    token: jwt,
    user: {
      ...link.user,
      createdAt: link.user.createdAt.toISOString(),
    },
  };
}
