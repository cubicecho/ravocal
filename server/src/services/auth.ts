import { randomBytes } from 'node:crypto';
import type { DB } from '@cubicecho/ravocal-db';
import { magicLinks, users } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { appUrl, jwtSecret } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import { MS_PER_MINUTE } from '../core/wire.ts';
import { sendMagicLinkEmail } from './email.ts';

/** How a session token is sent: `Authorization: Bearer <jwt>`. */
const BEARER_PREFIX = 'Bearer ';
/** What session tokens are signed with. */
const SESSION_TOKEN_ALGORITHM = 'HS256';

/**
 * The session-token key, from `JWT_SECRET`.
 *
 * @returns The key jose signs and verifies with.
 */
function sessionKey(): Uint8Array {
  return new TextEncoder().encode(jwtSecret());
}

/**
 * Signs a session token for a user.
 *
 * @param user - Who the token signs in.
 * @returns The JWT, valid for `AUTH_DEFAULTS.sessionTtlDays`.
 */
export function signSessionToken(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ sub: user.id, email: user.email })
    .setProtectedHeader({ alg: SESSION_TOKEN_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${AUTH_DEFAULTS.sessionTtlDays}d`)
    .sign(sessionKey());
}

/**
 * Reads who a request's session token belongs to.
 *
 * @param headers - The request's headers, carrying `Authorization: Bearer`.
 * @returns The user's id, or null when there is no token or it does not verify.
 */
export async function sessionUserId(headers: Headers): Promise<string | null> {
  const authorization = headers.get('authorization') ?? '';
  const hasBearer = authorization.startsWith(BEARER_PREFIX);
  if (hasBearer === false) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(authorization.slice(BEARER_PREFIX.length), sessionKey());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    // An expired, forged or garbled token is a signed-out caller, which resolvers refuse as UNAUTHENTICATED.
    return null;
  }
}

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
    throw badInput('Invalid or expired magic link');
  }
  if (link.usedAt) {
    throw badInput('Magic link already used');
  }
  if (link.expiresAt < new Date()) {
    throw badInput('Magic link expired');
  }

  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id));

  return {
    token: await signSessionToken(link.user),
    user: {
      ...link.user,
      createdAt: link.user.createdAt.toISOString(),
    },
  };
}
