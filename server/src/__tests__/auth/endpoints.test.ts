import { users, verifications } from '@cubicecho/ravocal-db/schema';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import { type Auth, MAGIC_LINK_PATH, type MagicLink, sessionUserId } from '../../auth/better-auth.ts';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createContextFactory } from '../../graphql/handler.ts';
import {
  bearer,
  closeTestDb,
  createClient,
  createLinklessAuth,
  createTestAuth,
  createTestDb,
  createUser,
  resetTestDb,
  type TestClient,
  type TestDb,
} from '../helpers.ts';

const CONFIG = 'query { authConfig { secureLocalNet magicLink } }';
const REQUEST = 'mutation ($email: String!) { signInMagicLink(email: $email) { status token userId } }';
const VERIFY = 'mutation ($token: String!) { magicLinkVerify(token: $token) { token user { id email name } } }';
const SIGN_OUT = 'mutation { signOut { success } }';
const SESSION = 'query { getSession { user { id email } session { userId } } }';
const SESSIONS = 'query { listSessions { token } }';
const REVOKE_OTHERS = 'mutation { revokeOtherSessions { status } }';
const MY_GROUPS = 'query { myGroups { id } }';

/** What an instance without SMTP_URL answers a request for a link. */
const NO_LINKS =
  'This instance cannot email sign-in links. Whoever runs it needs to set SMTP_URL, or SECURE_LOCAL_NET on a private network.';

let db: TestDb;
let auth: Auth;
let links: MagicLink[];
let anonymous: TestClient;

// Each test uses a fresh address, so no two of them can be read as one caller.
let addresses = 0;
const nextEmail = () => `user${++addresses}@example.com`;

/**
 * Asks for a link and returns the token it was sent with.
 *
 * @param email - Where the link goes.
 * @returns The link's token.
 */
async function linkTokenFor(email: string): Promise<string> {
  await anonymous.expectOk(REQUEST, { email });
  const link = links.at(-1);
  if (link === undefined) {
    throw new Error('No sign-in link was delivered.');
  }
  return link.token;
}

/**
 * Signs an address in through a link.
 *
 * @param email - The address.
 * @returns A client carrying the session, its token and its user.
 */
async function signedIn(email: string): Promise<{ client: TestClient; token: string; userId: string }> {
  const { magicLinkVerify } = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email) });
  const { token, user } = magicLinkVerify;
  return { client: createClient(db, user.id, { auth, headers: bearer(token) }), token, userId: user.id };
}

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => closeTestDb(db));

beforeEach(async () => {
  await resetTestDb(db);
  ({ auth, links } = createTestAuth(db));
  anonymous = createClient(db, null, { auth });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('authConfig', () => {
  it('offers links when the instance can deliver them', async () => {
    const { authConfig } = await anonymous.expectOk(CONFIG);
    expect(authConfig).toEqual({ secureLocalNet: false, magicLink: true });
  });

  it('offers nothing when the instance has no mail and no private network', async () => {
    const { authConfig } = await createClient(db, null, { auth: createLinklessAuth(db) }).expectOk(CONFIG);
    expect(authConfig).toEqual({ secureLocalNet: false, magicLink: false });
  });

  it('says so under SECURE_LOCAL_NET', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const { authConfig } = await createClient(db, null, { auth: createLinklessAuth(db) }).expectOk(CONFIG);
    expect(authConfig).toEqual({ secureLocalNet: true, magicLink: false });
  });
});

describe('signInMagicLink', () => {
  it("delivers a link to the app's verify page", async () => {
    const email = nextEmail();
    const { signInMagicLink } = await anonymous.expectOk(REQUEST, { email });
    expect(signInMagicLink).toEqual({ status: true, token: null, userId: null });
    expect(links).toHaveLength(1);
    const [link] = links;
    expect(link?.email).toBe(email);
    expect(link?.url).toContain(`${MAGIC_LINK_PATH}?token=${link?.token}`);
  });

  it('never puts the link in the response or the log', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await anonymous.run(REQUEST, { email: nextEmail() });
    const token = links[0]?.token ?? '';
    expect(token).not.toBe('');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(token);
  });

  it('refuses an address that is not one', async () => {
    const { code } = await anonymous.expectError(REQUEST, { email: 'not-an-address' });
    expect(code).toBe(ErrorCode.BadUserInput);
  });

  it('refuses, and says how to fix it, when the instance has no SMTP', async () => {
    const linkless = createClient(db, null, { auth: createLinklessAuth(db) });
    const { code, message } = await linkless.expectError(REQUEST, { email: nextEmail() });
    expect(code).toBe(ErrorCode.BadUserInput);
    expect(message).toBe(NO_LINKS);
  });

  it('signs straight in under SECURE_LOCAL_NET, with no link and no SMTP', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const linkless = createClient(db, null, { auth: createLinklessAuth(db) });
    const { signInMagicLink } = await linkless.expectOk(REQUEST, { email: nextEmail() });
    const { status, token, userId } = signInMagicLink;
    expect(status).toBe(true);
    expect(links).toHaveLength(0);
    expect(await sessionUserId(auth, bearer(token))).toBe(userId);
  });

  it('opens the account that already has the address under SECURE_LOCAL_NET', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const existing = await createUser(db, 'kept@example.com');
    const { signInMagicLink } = await anonymous.expectOk(REQUEST, { email: ' Kept@Example.com ' });
    expect(signInMagicLink.userId).toBe(existing);
    expect(await db.select().from(users)).toHaveLength(1);
  });
});

describe('magicLinkVerify', () => {
  it('trades the link for a session the server recognises', async () => {
    const { magicLinkVerify } = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(nextEmail()) });
    const { token, user } = magicLinkVerify;
    expect(await sessionUserId(auth, bearer(token))).toBe(user.id);
  });

  it('creates the account on first use, named for its address, and reuses it on the second', async () => {
    const email = nextEmail();
    const first = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email) });
    const second = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email.toUpperCase()) });
    expect(first.magicLinkVerify.user).toMatchObject({ email, name: email.split('@')[0] });
    expect(second.magicLinkVerify.user.id).toBe(first.magicLinkVerify.user.id);
  });

  it('opens an account that already has the address', async () => {
    const existing = await createUser(db, 'early@example.com');
    const { magicLinkVerify } = await anonymous.expectOk(VERIFY, { token: await linkTokenFor('early@example.com') });
    expect(magicLinkVerify.user.id).toBe(existing);
  });

  it('refuses a spent link as bad input, and leaves the session that tried it signed in', async () => {
    const { client, token: session } = await signedIn(nextEmail());
    const token = await linkTokenFor(nextEmail());
    await anonymous.expectOk(VERIFY, { token });
    const { code } = await client.expectError(VERIFY, { token });
    expect(code).toBe(ErrorCode.BadUserInput);
    expect(await sessionUserId(auth, bearer(session))).not.toBeNull();
  });

  it('refuses an unknown token as bad input, not as an expired session', async () => {
    // UNAUTHENTICATED is what the app drops its session on; a bad link is a bad argument.
    const { code } = await anonymous.expectError(VERIFY, { token: 'not-a-token' });
    expect(code).toBe(ErrorCode.BadUserInput);
  });

  it('refuses a link that has run out as bad input', async () => {
    const token = await linkTokenFor(nextEmail());
    await db.update(verifications).set({ expiresAt: new Date(Date.now() - 1) });
    const { code } = await anonymous.expectError(VERIFY, { token });
    expect(code).toBe(ErrorCode.BadUserInput);
  });

  it('refuses every link on an instance that sends none', async () => {
    const linkless = createClient(db, null, { auth: createLinklessAuth(db) });
    const { code } = await linkless.expectError(VERIFY, { token: 'any' });
    expect(code).toBe(ErrorCode.BadUserInput);
  });
});

describe('signOut', () => {
  it('ends the session, so a request that still carries its token is signed out', async () => {
    const { client, token } = await signedIn(nextEmail());
    const { signOut } = await client.expectOk(SIGN_OUT);
    expect(signOut).toEqual({ success: true });

    const createContext = createContextFactory({ db, authHost: fixedAuthHost(auth), limiter: createRateLimiter() });
    const context = await createContext(bearer(token));
    expect(context.userId).toBeNull();
    const { code } = await createClient(db, context.userId, { auth, headers: bearer(token) }).expectError(MY_GROUPS);
    expect(code).toBe(ErrorCode.Unauthenticated);
  });

  it('answers false for a request that carries no session', async () => {
    const { signOut } = await anonymous.expectOk(SIGN_OUT);
    expect(signOut).toEqual({ success: false });
  });
});

describe('sessions', () => {
  it("reads the caller's own session", async () => {
    const email = nextEmail();
    const { client, userId } = await signedIn(email);
    const { getSession } = await client.expectOk(SESSION);
    expect(getSession).toEqual({ user: { id: userId, email }, session: { userId } });
  });

  it('answers null for a request with no session', async () => {
    const { getSession } = await anonymous.expectOk(SESSION);
    expect(getSession).toBeNull();
  });

  it('lists every session of the account, and ends all but this one', async () => {
    const email = nextEmail();
    const { client, token } = await signedIn(email);
    const other = await signedIn(email);
    const { listSessions } = await client.expectOk(SESSIONS);
    const tokens = listSessions.map((session: { token: string }) => session.token);
    expect(tokens.sort()).toEqual([token, other.token].sort());

    await client.expectOk(REVOKE_OTHERS);
    expect(await sessionUserId(auth, bearer(other.token))).toBeNull();
    expect(await sessionUserId(auth, bearer(token))).not.toBeNull();
  });

  it('refuses listing sessions without one as signed out', async () => {
    const { code } = await anonymous.expectError(SESSIONS);
    expect(code).toBe(ErrorCode.Unauthenticated);
  });
});
