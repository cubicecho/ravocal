import { once } from 'node:events';
import type { Server } from 'node:http';
import { accounts, users } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthHost, createAuthHost, fixedAuthHost } from '../../auth/auth-host.ts';
import type { Auth, MagicLink } from '../../auth/better-auth.ts';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { ProviderId } from '../../core/config.ts';
import { AUTH_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { MS_PER_MINUTE } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { SsoError } from '../../http/sso.ts';
import {
  bearer,
  closeTestDb,
  createClient,
  createSessionToken,
  createTestAuth,
  createTestDb,
  createUser,
  portOf,
  resetTestDb,
  TEST_SECRET,
  type TestDb,
} from '../helpers.ts';
import { cookiesFrom, locationOf } from './fixtures/browser.ts';
import { FAKE_PROVIDERS, type FakeProvider, startFakeProvider } from './fixtures/fake-provider.ts';

// A provider's whole sign-in through the real app, over HTTP, against a stand-in for Google and Facebook on a loopback
// port (fixtures/fake-provider.ts). The test plays the browser: it follows each redirect by hand, carrying cookies.

const VERIFY = 'mutation ($token: String!) { verifyOneTimeToken(token: $token) { token userId } }';
const ME = '{ getSession { user { id email } } }';
const CONFIG = '{ authConfig { providers { id name signInUrl } } }';
const LINK = 'mutation ($provider: String!) { linkSocialAccount(provider: $provider) { url } }';
const ACCOUNTS = '{ listUserAccounts { id providerId } }';
const UNLINK = 'mutation ($accountId: String!) { unlinkAccount(accountId: $accountId) { status } }';
const SIGN_IN = 'mutation ($email: String!) { signInMagicLink(email: $email) { token userId } }';
const REQUEST_LINK = 'mutation ($email: String!) { signInMagicLink(email: $email) { status } }';
const VERIFY_LINK = 'mutation ($token: String!) { magicLinkVerify(token: $token) { token user { id } } }';

let db: TestDb;
let provider: FakeProvider;
let auth: Auth;
let links: MagicLink[];
let authHost: AuthHost;
let server: Server;
let appUrl: string;

/**
 * Serves the real app on a free port. APP_URL has to name that port before the app's auth is built, so the app is
 * mounted into an outer one that is already listening.
 *
 * @param build - Builds the auth host, once APP_URL and SERVER_URL are set.
 * @returns The host it was built with.
 */
async function serve(build: () => Promise<AuthHost>): Promise<AuthHost> {
  const outer = express();
  server = outer.listen(0, '127.0.0.1');
  await once(server, 'listening');
  appUrl = `http://127.0.0.1:${portOf(server)}`;
  vi.stubEnv('APP_URL', appUrl);
  vi.stubEnv('SERVER_URL', appUrl);
  const host = await build();
  outer.use(createApp({ db, authHost: host, limiter: createRateLimiter() }));
  return host;
}

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => closeTestDb(db));

beforeEach(async () => {
  await resetTestDb(db);
  provider = await startFakeProvider();
  // Refusals are logged by better-auth and by http/sso.ts; keep them out of the run's output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  authHost = await serve(async () => {
    ({ auth, links } = createTestAuth(db, { providers: FAKE_PROVIDERS, providerEndpoints: provider.endpoints }));
    return fixedAuthHost(auth, FAKE_PROVIDERS);
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await provider.close();
});

/**
 * Follows a provider's authorize page back to the app's callback, as the browser would once the reader agreed.
 *
 * @param authorizeUrl - Where the app sent the browser.
 * @param cookie - The cookies the browser holds for the app.
 * @param [tamper] - Changes the provider's redirect before the browser follows it.
 * @returns The callback's response.
 */
async function returnFromProvider(authorizeUrl: string, cookie: string, tamper?: (back: URL) => void) {
  const redirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri') ?? '';
  const { code, state } = provider.authorize(authorizeUrl);
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  tamper?.(back);
  return fetch(back, { redirect: 'manual', headers: { cookie } });
}

/**
 * Walks the browser through a sign-in: the start route, the provider, the callback.
 *
 * @param id - The provider to sign in with.
 * @param [tamper] - Changes the provider's redirect before the browser follows it.
 * @returns Where the callback sent the browser, and the callback's response.
 */
async function signIn(id: ProviderId, tamper?: (back: URL) => void): Promise<{ location: URL; callback: Response }> {
  const start = await fetch(`${appUrl}/sso/${id}`, { redirect: 'manual' });
  const authorizeUrl = locationOf(start).toString();
  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(`${appUrl}/api/auth/callback/${id}`);
  const callback = await returnFromProvider(authorizeUrl, cookiesFrom(start), tamper);
  return { location: locationOf(callback), callback };
}

/**
 * Runs an operation against the app over HTTP.
 *
 * @param query - The document.
 * @param [variables] - Its variables.
 * @param [token] - A session to send as the bearer.
 * @returns The response and its parsed body.
 */
async function graphqlOverHttp(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${appUrl}/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return { response, body: await response.json() };
}

/**
 * Swaps the one-time token a sign-in landed with for its session, as the app's /auth/sso page does.
 *
 * @param location - Where the callback sent the browser.
 * @returns The session's token and user.
 */
async function verified(location: URL): Promise<{ token: string; userId: string }> {
  expect(`${location.origin}${location.pathname}`).toBe(`${appUrl}/auth/sso`);
  const { body } = await graphqlOverHttp(VERIFY, { token: location.searchParams.get('token') });
  expect(body.errors).toBeUndefined();
  return body.data.verifyOneTimeToken;
}

/**
 * Reads a user's row.
 *
 * @param email - Their address.
 * @returns The row, or undefined when there is none.
 */
async function userByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

/**
 * Reads the providers a user has connected.
 *
 * @param userId - The user.
 * @returns Their account rows' provider ids.
 */
async function providersOf(userId: string): Promise<string[]> {
  const rows = await db.select().from(accounts).where(eq(accounts.userId, userId));
  return rows.map((row: { providerId: string }) => row.providerId);
}

describe('signing in with Google', () => {
  it('lands on /auth/sso with a one-time token that verifyOneTimeToken swaps for a session', async () => {
    const { location, callback } = await signIn(ProviderId.Google);
    // The session reaches the app as a bearer token, never as a cookie.
    expect(callback.headers.getSetCookie().some((cookie) => cookie.includes('session_token'))).toBe(false);

    const session = await verified(location);
    const { body } = await graphqlOverHttp(ME, {}, session.token);
    expect(body.data.getSession.user).toEqual({ id: session.userId, email: provider.google.email });
    expect(await providersOf(session.userId)).toEqual([ProviderId.Google]);
  });

  it('spends the one-time token once', async () => {
    const { location } = await signIn(ProviderId.Google);
    await verified(location);
    const again = await createClient(db, null, { auth }).expectError(VERIFY, {
      token: location.searchParams.get('token'),
    });
    expect(again.code).toBe(ErrorCode.BadUserInput);
  });

  it('refuses a one-time token after its lifetime', async () => {
    const { location } = await signIn(ProviderId.Google);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + AUTH_DEFAULTS.oneTimeTokenTtlMinutes * MS_PER_MINUTE + 1);
    const late = await createClient(db, null, { auth }).expectError(VERIFY, {
      token: location.searchParams.get('token'),
    });
    expect(late.code).toBe(ErrorCode.BadUserInput);
  });

  it('signs in to the magic-link account that has the address', async () => {
    const existing = await createUser(db, 'ada@example.com');
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing));
    const { location } = await signIn(ProviderId.Google);
    expect((await verified(location)).userId).toBe(existing);
    expect(await providersOf(existing)).toEqual([ProviderId.Google]);
  });

  it('signs in to an account made under SECURE_LOCAL_NET, and confirms its address', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const { signInMagicLink } = await createClient(db, null, { auth }).expectOk(SIGN_IN, { email: 'ada@example.com' });
    expect((await userByEmail('ada@example.com'))?.emailVerified).toBe(false);
    vi.stubEnv('SECURE_LOCAL_NET', '');

    const { location } = await signIn(ProviderId.Google);
    expect((await verified(location)).userId).toBe(signInMagicLink.userId);
    expect((await userByEmail('ada@example.com'))?.emailVerified).toBe(true);
  });

  it('refuses an address Google did not check when an account already has it, as Facebook is refused', async () => {
    const existing = await createUser(db, 'ada@example.com');
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing));
    provider.google = { ...provider.google, email_verified: false };
    const { location } = await signIn(ProviderId.Google);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('account_not_linked');
    expect(location.searchParams.get('provider')).toBe(ProviderId.Google);
    expect(await providersOf(existing)).toEqual([]);
  });

  it('makes an account with the address not yet confirmed when Google did not check a new address', async () => {
    provider.google = { ...provider.google, email_verified: false };
    const session = await verified((await signIn(ProviderId.Google)).location);
    expect(await userByEmail('ada@example.com')).toMatchObject({ id: session.userId, emailVerified: false });
    expect(await providersOf(session.userId)).toEqual([ProviderId.Google]);
  });

  it('refuses a callback whose state does not match', async () => {
    const { location } = await signIn(ProviderId.Google, (back) => back.searchParams.set('state', 'forged'));
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('state_mismatch');
    expect(location.searchParams.get('token')).toBeNull();
  });
});

describe('signing in with Facebook', () => {
  it('makes an account for a new address, with the address not yet confirmed', async () => {
    const session = await verified((await signIn(ProviderId.Facebook)).location);
    const user = await userByEmail('ada@example.com');
    expect(user).toMatchObject({ id: session.userId, name: 'Ada', emailVerified: false });
    expect(await providersOf(session.userId)).toEqual([ProviderId.Facebook]);
  });

  it('refuses an address an account already has, and says which provider', async () => {
    const existing = await createUser(db, 'ada@example.com');
    const { location } = await signIn(ProviderId.Facebook);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('account_not_linked');
    expect(location.searchParams.get('provider')).toBe(ProviderId.Facebook);
    expect(await providersOf(existing)).toEqual([]);
  });

  it('sends a reader with no address back to the login page', async () => {
    provider.facebook = { id: 'fb-nomail', name: 'No Mail' };
    const { location } = await signIn(ProviderId.Facebook);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('email_not_found');
    expect(await db.select().from(users)).toEqual([]);
  });
});

/**
 * Starts a link over GraphQL as the app does, then follows it through the provider back to the app.
 *
 * @param id - The provider to connect.
 * @param token - The reader's session.
 * @returns Where the callback sent the browser.
 */
async function connect(id: ProviderId, token: string): Promise<URL> {
  const { response, body } = await graphqlOverHttp(LINK, { provider: id }, token);
  expect(body.errors).toBeUndefined();
  const cookie = cookiesFrom(response);
  expect(cookie).toContain('state=');
  return locationOf(await returnFromProvider(body.data.linkSocialAccount.url, cookie));
}

/**
 * Signs an address in by magic link over HTTP, as its owner following the email would.
 *
 * @param email - The address.
 * @returns The session's token and user.
 */
async function signInByLink(email: string): Promise<{ token: string; userId: string }> {
  const requested = await graphqlOverHttp(REQUEST_LINK, { email });
  expect(requested.body.errors).toBeUndefined();
  const { body } = await graphqlOverHttp(VERIFY_LINK, { token: links.at(-1)?.token });
  expect(body.errors).toBeUndefined();
  return { token: body.data.magicLinkVerify.token, userId: body.data.magicLinkVerify.user.id };
}

/**
 * Asks better-auth whose a bearer session is.
 *
 * @param token - The session token.
 * @returns The user's id, or null when the session is gone.
 */
async function sessionOwner(token: string): Promise<string | null> {
  const session = await auth.api.getSession({ headers: bearer(token) });
  return session?.user.id ?? null;
}

describe('connecting a provider in Settings', () => {
  it('connects Facebook to the signed-in reader, after which Facebook signs them in', async () => {
    const reader = await createUser(db, 'ada@example.com');
    const location = await connect(ProviderId.Facebook, await createSessionToken(auth, reader));
    expect(`${location.origin}${location.pathname}`).toBe(`${appUrl}/settings`);
    expect(location.searchParams.get('connected')).toBe(ProviderId.Facebook);
    expect(await providersOf(reader)).toEqual([ProviderId.Facebook]);

    const { location: signedIn } = await signIn(ProviderId.Facebook);
    expect((await verified(signedIn)).userId).toBe(reader);
  });

  it('connects a Facebook account with another address', async () => {
    const reader = await createUser(db, 'ada@work.example');
    await connect(ProviderId.Facebook, await createSessionToken(auth, reader));
    expect(await providersOf(reader)).toEqual([ProviderId.Facebook]);
  });

  it('refuses a provider this instance does not offer', async () => {
    const reader = await createUser(db, 'ada@example.com');
    const linkless = fixedAuthHost(
      auth,
      FAKE_PROVIDERS.filter((offered) => offered.id === ProviderId.Google),
    );
    const client = createClient(db, reader, {
      authHost: linkless,
      headers: bearer(await createSessionToken(auth, reader)),
    });
    const { code } = await client.expectError(LINK, { provider: ProviderId.Facebook });
    expect(code).toBe(ErrorCode.BadUserInput);
  });
});

describe('proving the address of an account nobody had proven', () => {
  const VICTIM = 'victim@example.com';

  /**
   * Signs up at Facebook with someone else's address, as an attacker waiting for its owner would.
   *
   * @returns The attacker's session.
   */
  async function facebookSignUp(): Promise<{ token: string; userId: string }> {
    provider.facebook = { id: 'fb-mallory', name: 'Mallory', email: VICTIM };
    return verified((await signIn(ProviderId.Facebook)).location);
  }

  it('ends the Facebook sign-up and its sessions when a magic link proves the address', async () => {
    const attacker = await facebookSignUp();
    const owner = await signInByLink(VICTIM);
    expect(owner.userId).toBe(attacker.userId);
    expect(await sessionOwner(attacker.token)).toBeNull();
    expect(await sessionOwner(owner.token)).toBe(owner.userId);
    expect(await providersOf(owner.userId)).toEqual([]);
    expect((await userByEmail(VICTIM))?.emailVerified).toBe(true);

    // Facebook cannot get back in: it never vouches for an address an account has.
    const { location } = await signIn(ProviderId.Facebook);
    expect(location.searchParams.get('error')).toBe('account_not_linked');
  });

  it('ends them when a Google sign-in that Google checked proves the address, and keeps that Google', async () => {
    const attacker = await facebookSignUp();
    provider.google = { sub: 'g-victim', email: VICTIM, email_verified: true, name: 'Victim' };
    const owner = await verified((await signIn(ProviderId.Google)).location);
    expect(owner.userId).toBe(attacker.userId);
    expect(await sessionOwner(attacker.token)).toBeNull();
    expect(await sessionOwner(owner.token)).toBe(owner.userId);
    expect(await providersOf(owner.userId)).toEqual([ProviderId.Google]);
  });

  it('ends a Google sign-up whose address Google had not checked', async () => {
    provider.google = { sub: 'g-mallory', email: VICTIM, email_verified: false, name: 'Mallory' };
    const attacker = await verified((await signIn(ProviderId.Google)).location);
    const owner = await signInByLink(VICTIM);
    expect(await sessionOwner(attacker.token)).toBeNull();
    expect(await providersOf(owner.userId)).toEqual([]);
  });

  it('keeps Facebook connected from Settings by a session that had proven the address', async () => {
    const reader = await signInByLink(VICTIM);
    await connect(ProviderId.Facebook, reader.token);
    const again = await signInByLink(VICTIM);
    expect(again.userId).toBe(reader.userId);
    expect(await providersOf(reader.userId)).toEqual([ProviderId.Facebook]);
    expect(await sessionOwner(reader.token)).toBe(reader.userId);
  });
});

describe('disconnecting a provider', () => {
  /**
   * Signs a reader in with Facebook alone, and hands back a client carrying the session.
   *
   * @returns The client, and the id of the Facebook account row.
   */
  async function facebookOnlyReader() {
    const session = await verified((await signIn(ProviderId.Facebook)).location);
    const client = createClient(db, session.userId, { authHost, headers: bearer(session.token) });
    const { listUserAccounts } = await client.expectOk(ACCOUNTS);
    return { client, userId: session.userId, accountId: listUserAccounts[0].id };
  }

  it('refuses the last way to sign in while the address is unconfirmed', async () => {
    const { client, userId, accountId } = await facebookOnlyReader();
    const { code } = await client.expectError(UNLINK, { accountId });
    expect(code).toBe(ErrorCode.BadUserInput);
    expect(await providersOf(userId)).toEqual([ProviderId.Facebook]);
  });

  it('lets it go once an email link would still sign the reader in', async () => {
    const { client, userId, accountId } = await facebookOnlyReader();
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
    expect(await client.expectOk(UNLINK, { accountId })).toEqual({ unlinkAccount: { status: true } });
    expect(await providersOf(userId)).toEqual([]);
  });
});

describe('the start and callback routes', () => {
  it.each(['github', ProviderId.Google])('send %s back to the login page when it is not offered', async (id) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await serve(async () => fixedAuthHost(createTestAuth(db).auth));
    for (const path of [`/sso/${id}`, `/api/auth/callback/${id}?code=c&state=s`]) {
      const location = locationOf(await fetch(`${appUrl}${path}`, { redirect: 'manual' }));
      expect(`${location.origin}${location.pathname}`).toBe(`${appUrl}/login`);
      expect(location.searchParams.get('error')).toBe(SsoError.Off);
    }
  });
});

describe('authConfig.providers', () => {
  /**
   * Builds a host from the environment as it is now, as index.ts does.
   *
   * @returns The host.
   */
  const hostFromEnvironment = () => createAuthHost(db, { secret: TEST_SECRET, providerEndpoints: provider.endpoints });

  it('is empty with no provider in the environment', async () => {
    const host = await hostFromEnvironment();
    const { authConfig } = await createClient(db, null, { authHost: host }).expectOk(CONFIG);
    expect(authConfig.providers).toEqual([]);
  });

  it('lists each provider set in the environment, with where its button points', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    vi.stubEnv('FACEBOOK_CLIENT_ID', 'id');
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'secret');
    const host = await hostFromEnvironment();
    const { authConfig } = await createClient(db, null, { authHost: host }).expectOk(CONFIG);
    expect(authConfig.providers).toEqual([
      { id: ProviderId.Google, name: 'Google', signInUrl: `${appUrl}/sso/${ProviderId.Google}` },
      { id: ProviderId.Facebook, name: 'Facebook', signInUrl: `${appUrl}/sso/${ProviderId.Facebook}` },
    ]);
  });

  it('follows a rebuild, so a provider set later is offered without a restart', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const host = await serve(hostFromEnvironment);
    const client = createClient(db, null, { authHost: host });
    expect((await client.expectOk(CONFIG)).authConfig.providers).toEqual([]);
    expect(locationOf(await fetch(`${appUrl}/sso/${ProviderId.Facebook}`, { redirect: 'manual' })).pathname).toBe(
      '/login',
    );

    vi.stubEnv('FACEBOOK_CLIENT_ID', 'ravocal-facebook');
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'facebook-secret');
    await host.rebuild();
    const { providers } = (await client.expectOk(CONFIG)).authConfig;
    expect(providers.map((offered: { id: string }) => offered.id)).toEqual([ProviderId.Facebook]);
    const start = await fetch(`${appUrl}/sso/${ProviderId.Facebook}`, { redirect: 'manual' });
    expect(locationOf(start).toString().startsWith(provider.endpoints.facebook.authorizationUrl)).toBe(true);
  });
});
