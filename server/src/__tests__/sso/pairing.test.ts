import { once } from 'node:events';
import type { Server } from 'node:http';
import { format } from 'node:util';
import { accounts, oidcSettings, users } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthHost, createAuthHost } from '../../auth/auth-host.ts';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { ProviderId } from '../../core/config.ts';
import { AUTH_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { SsoError } from '../../http/sso.ts';
import { PairingFailure, parseSetupUrl } from '../../sso/pairing.ts';
import { readPairedOidc, SsoSource } from '../../sso/settings.ts';
import {
  closeTestDb,
  createClient,
  createSessionToken,
  createTestDb,
  createUser,
  portOf,
  resetTestDb,
  TEST_SECRET,
  type TestDb,
} from '../helpers.ts';
import { cookiesFrom, locationOf } from '../http/fixtures/browser.ts';
import {
  BAD_REDIRECT_DESCRIPTION,
  type FakeDcr,
  REGISTERED,
  REGISTRATION_TOKEN,
  SETUP_TOKEN,
  startFakeDcr,
} from './fixtures/fake-dcr.ts';

// Pairing the instance with an OIDC provider by pasting a setup URL, through the real app over HTTP, against a
// stand-in that does Dynamic Client Registration on a loopback port (fixtures/fake-dcr.ts); then signing in through
// the provider it paired, playing the browser.

const SETUP = '{ ssoSetup { source issuer name canPair redirectUri } }';
const PAIR = 'mutation ($url: String!) { pairSso(setupUrl: $url) { source issuer name canPair } }';
const UNPAIR = 'mutation { unpairSso { source issuer name canPair } }';
const CONFIG = '{ authConfig { providers { id name signInUrl } } }';
const VERIFY = 'mutation ($token: String!) { verifyOneTimeToken(token: $token) { token userId } }';
const ME = '{ getSession { user { id email name } } }';

/** A setup token that was never handed out, or was spent. */
const SPENT_TOKEN = 'iat-spent-9876543210';

let db: TestDb;
let dcr: FakeDcr;
let host: AuthHost;
let server: Server;
let appUrl: string;
/** Every line logged during the test, formatted as the console would print it. */
let logged: string[];
/** Every response body the app sent during the test. */
let responses: string[];

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => closeTestDb(db));

beforeEach(async () => {
  await resetTestDb(db);
  dcr = await startFakeDcr();
  logged = [];
  responses = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(format(...args));
    });
  }
  // The app is mounted into an outer one already listening, so APP_URL can name its port before auth is built.
  const outer = express();
  server = outer.listen(0, '127.0.0.1');
  await once(server, 'listening');
  appUrl = `http://127.0.0.1:${portOf(server)}`;
  vi.stubEnv('APP_URL', appUrl);
  vi.stubEnv('SERVER_URL', appUrl);
  host = await createAuthHost(db, { secret: TEST_SECRET });
  outer.use(createApp({ db, authHost: host, limiter: createRateLimiter() }));
});

afterEach(async () => {
  // The setup token is a credential: whatever a test did, it was never logged or sent back.
  for (const token of [SETUP_TOKEN, SPENT_TOKEN]) {
    expect(logged.filter((line) => line.includes(token))).toEqual([]);
    expect(responses.filter((body) => body.includes(token))).toEqual([]);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await dcr.close();
});

/**
 * Runs an operation against the app over HTTP, keeping what it answered.
 *
 * @param query - The document.
 * @param [variables] - Its variables.
 * @param [token] - A session to send as the bearer.
 * @returns The parsed body.
 */
async function gql(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${appUrl}/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  responses.push(text);
  return JSON.parse(text);
}

/**
 * Runs an operation that should succeed.
 *
 * @param query - The document.
 * @param [variables] - Its variables.
 * @param [token] - A session to send as the bearer.
 * @returns Its `data`.
 */
async function ok(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const body = await gql(query, variables, token);
  expect(body.errors).toBeUndefined();
  return body.data;
}

/**
 * Runs an operation that should fail once.
 *
 * @param query - The document.
 * @param [variables] - Its variables.
 * @param [token] - A session to send as the bearer.
 * @returns The error's message, code and reason.
 */
async function refused(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const body = await gql(query, variables, token);
  expect(body.errors).toHaveLength(1);
  const [error] = body.errors;
  return { message: error.message as string, code: error.extensions?.code, reason: error.extensions?.reason };
}

/**
 * Makes an account the instance's admin, as the first sign-up would have.
 *
 * @param email - Their address.
 * @returns Their id and a session for them.
 */
async function makeAdmin(email: string): Promise<{ id: string; token: string }> {
  const id = await createUser(db, email);
  await db.update(users).set({ isAdmin: true, emailVerified: true }).where(eq(users.id, id));
  return { id, token: await createSessionToken(host.current(), id) };
}

/**
 * Makes an account that is not the admin.
 *
 * @param email - Their address.
 * @returns Their id and a session for them.
 */
async function makeMember(email: string): Promise<{ id: string; token: string }> {
  const id = await createUser(db, email);
  return { id, token: await createSessionToken(host.current(), id) };
}

/**
 * Reads the providers the login page offers.
 *
 * @returns Their ids.
 */
async function offered(): Promise<string[]> {
  const { authConfig } = await ok(CONFIG);
  return authConfig.providers.map((provider: { id: string }) => provider.id);
}

describe('setup URLs', () => {
  it('are taken apart into the issuer, the token and the name', () => {
    expect(parseSetupUrl(' https://id.example.com/oidc/?x=1#setup=abc&name=heautou ')).toEqual({
      issuer: 'https://id.example.com/oidc',
      token: 'abc',
      name: 'heautou',
    });
  });

  it('name a provider with no name SSO', () => {
    expect(parseSetupUrl('http://id.lan/oidc#setup=abc').name).toBe(AUTH_DEFAULTS.oidcName);
    expect(parseSetupUrl('http://id.lan/oidc#setup=abc&name=%20').name).toBe('SSO');
  });

  it.each([
    ['not a URL', 'not a url', /not a URL/],
    ['not http(s)', 'ftp://id.example.com/oidc#setup=abc', /https:\/\//],
    ['without a setup token', 'https://id.example.com/oidc#name=heautou', /no setup token/],
    ['with an empty setup token', 'https://id.example.com/oidc#setup=', /no setup token/],
  ])('refuse anything %s as BAD_URL', (_what, text, message) => {
    expect(() => parseSetupUrl(text)).toThrow(message);
    expect(() => parseSetupUrl(text)).toThrow(expect.objectContaining({ reason: PairingFailure.BadUrl }));
  });

  it('are refused in production as BAD_URL when they are http:// on a public host', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const text = `http://id.example.com/oidc#setup=${SETUP_TOKEN}`;
    expect(() => parseSetupUrl(text)).toThrow(expect.objectContaining({ reason: PairingFailure.BadUrl }));
    expect(() => parseSetupUrl(text)).toThrow(/https:\/\//);
    expect(parseSetupUrl(`https://id.example.com/oidc#setup=${SETUP_TOKEN}`).issuer).toBe(
      'https://id.example.com/oidc',
    );
    expect(parseSetupUrl(`http://id.lan/oidc#setup=${SETUP_TOKEN}`).issuer).toBe('http://id.lan/oidc');
  });

  it('are refused over the API as BAD_USER_INPUT, with the reason', async () => {
    expect(await refused(PAIR, { url: 'https://id.example.com/oidc' })).toMatchObject({
      code: ErrorCode.BadUserInput,
      reason: PairingFailure.BadUrl,
    });
    expect(await refused(PAIR, { url: '  ' })).toMatchObject({ code: ErrorCode.BadUserInput });
    expect(dcr.registrations).toEqual([]);
  });
});

describe('pairSso', () => {
  it('registers the callback as the redirect URI and offers the button without a restart', async () => {
    expect(await offered()).toEqual([]);
    expect((await ok(SETUP)).ssoSetup).toEqual({
      source: SsoSource.None,
      issuer: null,
      name: null,
      canPair: true,
      redirectUri: `${appUrl}/api/auth/callback/oidc`,
    });

    const { pairSso } = await ok(PAIR, { url: dcr.setupUrl(SETUP_TOKEN, 'heautou') });
    expect(pairSso).toEqual({ source: SsoSource.Paired, issuer: dcr.issuer, name: 'heautou', canPair: true });

    expect(dcr.registrations).toEqual([
      {
        authorization: `Bearer ${SETUP_TOKEN}`,
        body: {
          client_name: 'Ravocal',
          redirect_uris: [`${appUrl}/api/auth/callback/oidc`],
          token_endpoint_auth_method: 'client_secret_basic',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        },
      },
    ]);
    expect(await readPairedOidc(db)).toEqual({
      issuer: dcr.issuer,
      clientId: REGISTERED.clientId,
      clientSecret: REGISTERED.clientSecret,
      clientAuth: 'client_secret_basic',
      name: 'heautou',
      registrationAccessToken: REGISTRATION_TOKEN,
      registrationClientUri: `${dcr.issuer}/register/${REGISTERED.clientId}`,
    });

    const { authConfig } = await ok(CONFIG);
    expect(authConfig.providers).toEqual([
      { id: ProviderId.Oidc, name: 'heautou', signInUrl: `${appUrl}/sso/${ProviderId.Oidc}` },
    ]);
    // The running server's sign-in now goes to the provider, as the registered client.
    const authorize = locationOf(await fetch(`${appUrl}/sso/${ProviderId.Oidc}`, { redirect: 'manual' }));
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${dcr.issuer}/auth`);
    expect(authorize.searchParams.get('client_id')).toBe(REGISTERED.clientId);
  });

  it('pairs with a provider over http:// on this machine in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(dcr.issuer.startsWith('http://127.0.0.1:')).toBe(true);
    expect((await ok(PAIR, { url: dcr.setupUrl() })).pairSso.source).toBe(SsoSource.Paired);
  });

  it('says a spent setup URL is expired, and keeps nothing', async () => {
    const error = await refused(PAIR, { url: dcr.setupUrl(SPENT_TOKEN) });
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.Expired });
    expect(error.message).toMatch(/Ask your provider for a new one/);
    expect(await readPairedOidc(db)).toBeNull();
    expect(await offered()).toEqual([]);
  });

  it("passes on the provider's reason for refusing the registration", async () => {
    dcr.answer = 'badRedirect';
    const error = await refused(PAIR, { url: dcr.setupUrl() });
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.Refused });
    expect(error.message).toContain(BAD_REDIRECT_DESCRIPTION);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('says when the provider is rate limiting, as TOO_MANY_REQUESTS', async () => {
    dcr.answer = 'rateLimited';
    expect(await refused(PAIR, { url: dcr.setupUrl() })).toMatchObject({
      code: ErrorCode.TooManyRequests,
      reason: PairingFailure.RateLimited,
    });
  });

  it('refuses a discovery document naming another issuer before the token is sent', async () => {
    dcr.claimedIssuer = 'https://evil.example.com/oidc';
    expect(await refused(PAIR, { url: dcr.setupUrl() })).toMatchObject({
      code: ErrorCode.BadUserInput,
      reason: PairingFailure.NotAProvider,
    });
    expect(dcr.registrations).toEqual([]);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('refuses a registration endpoint that redirects, and never sends the token on', async () => {
    dcr.answer = 'redirect';
    const error = await refused(PAIR, { url: dcr.setupUrl() });
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.NotAProvider });
    expect(error.message).toMatch(/redirect/);
    expect(dcr.registrations).toHaveLength(1);
    expect(dcr.redirected).toEqual([]);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('says nothing answers at an unreachable URL', async () => {
    const error = await refused(PAIR, { url: `http://127.0.0.1:1/oidc#setup=${SETUP_TOKEN}` });
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.NotAProvider });
    expect(error.message).toMatch(/Could not reach http:\/\/127\.0\.0\.1:1/);
  });

  it('says a provider without a registration endpoint cannot pair, and what to do instead', async () => {
    dcr.canRegister = false;
    const error = await refused(PAIR, { url: dcr.setupUrl() });
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.NoRegistration });
    expect(error.message).toMatch(/OIDC_ISSUER and OIDC_CLIENT_ID/);
  });

  it('will not pair over an existing pairing', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    const error = await refused(PAIR, { url: dcr.setupUrl() });
    expect(error).toMatchObject({ code: ErrorCode.Conflict });
    expect(error.message).toMatch(/Disconnect it first/);
    expect(dcr.registrations).toHaveLength(1);
  });
});

describe('who may pair', () => {
  it('is anyone while the instance has no accounts', async () => {
    expect((await ok(SETUP)).ssoSetup.canPair).toBe(true);
    expect((await ok(PAIR, { url: dcr.setupUrl() })).pairSso.source).toBe(SsoSource.Paired);
  });

  it('is only the admin once anyone has an account', async () => {
    const admin = await makeAdmin('admin@example.com');
    const member = await makeMember('member@example.com');

    for (const token of [undefined, member.token]) {
      expect((await ok(SETUP, {}, token)).ssoSetup).toMatchObject({ canPair: false, issuer: null });
      const error = await refused(PAIR, { url: dcr.setupUrl() }, token);
      expect(error).toEqual({
        code: ErrorCode.Forbidden,
        reason: undefined,
        message: 'Only the admin can change how people sign in.',
      });
    }
    expect(dcr.registrations).toEqual([]);

    expect((await ok(SETUP, {}, admin.token)).ssoSetup.canPair).toBe(true);
    await ok(PAIR, { url: dcr.setupUrl() }, admin.token);
    expect((await ok(SETUP, {}, admin.token)).ssoSetup).toMatchObject({ source: SsoSource.Paired, issuer: dcr.issuer });
    // Everyone sees the button; only the admin sees where it goes.
    expect((await ok(SETUP, {}, member.token)).ssoSetup).toMatchObject({ source: SsoSource.Paired, issuer: null });
    expect((await refused(UNPAIR, {}, member.token)).code).toBe(ErrorCode.Forbidden);
    expect(await readPairedOidc(db)).not.toBeNull();
  });

  it('is nobody when OIDC_ISSUER names the provider, which wins over a pairing', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    vi.stubEnv('OIDC_ISSUER', 'https://env.example.com/oidc/');
    vi.stubEnv('OIDC_CLIENT_ID', 'env-client');
    vi.stubEnv('OIDC_NAME', 'Corp SSO');
    await host.rebuild();
    const admin = await makeAdmin('admin@example.com');

    expect((await ok(SETUP, {}, admin.token)).ssoSetup).toMatchObject({
      source: SsoSource.Env,
      issuer: null,
      name: 'Corp SSO',
      canPair: false,
    });
    expect((await ok(CONFIG)).authConfig.providers).toEqual([
      { id: ProviderId.Oidc, name: 'Corp SSO', signInUrl: `${appUrl}/sso/${ProviderId.Oidc}` },
    ]);
    for (const query of [PAIR, UNPAIR]) {
      expect(await refused(query, { url: dcr.setupUrl() }, admin.token)).toMatchObject({
        code: ErrorCode.Forbidden,
        message: "Sign-in is set by OIDC_ISSUER in the server's environment. Change it there.",
      });
    }
    expect(dcr.deletions).toEqual([]);
  });
});

describe('the sign-in throttle', () => {
  /**
   * Builds an anonymous caller whose address may change sign-in once per flow.
   *
   * @returns The caller, in process, on the running server's auth host.
   */
  const throttled = () => createClient(db, null, { authHost: host, limiter: createRateLimiter({ maxAttempts: 1 }) });

  it('refuses pairSso past the budget before anything reaches the provider', async () => {
    const caller = throttled();
    expect((await caller.expectError(PAIR, { url: 'not a url' })).code).toBe(ErrorCode.BadUserInput);
    expect((await caller.expectError(PAIR, { url: dcr.setupUrl() })).code).toBe(ErrorCode.TooManyRequests);
    expect(dcr.registrations).toEqual([]);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('refuses unpairSso past its own budget', async () => {
    const caller = throttled();
    await caller.expectError(PAIR, { url: 'not a url' });
    expect((await caller.expectOk(UNPAIR)).unpairSso.source).toBe(SsoSource.None);
    expect((await caller.expectError(UNPAIR)).code).toBe(ErrorCode.TooManyRequests);
  });
});

describe('unpairSso', () => {
  it('deletes the client at the provider with its registration token, and takes the button away', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    const { unpairSso } = await ok(UNPAIR);
    expect(unpairSso).toEqual({ source: SsoSource.None, issuer: null, name: null, canPair: true });
    expect(dcr.deletions).toEqual([`Bearer ${REGISTRATION_TOKEN}`]);
    expect(await readPairedOidc(db)).toBeNull();
    expect(await offered()).toEqual([]);

    const start = locationOf(await fetch(`${appUrl}/sso/${ProviderId.Oidc}`, { redirect: 'manual' }));
    expect(start.searchParams.get('error')).toBe(SsoError.Off);
  });

  it('counts a client the provider no longer has (404) as gone', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    dcr.deleteStatus = HttpStatus.NotFound;
    await ok(UNPAIR);
    expect(await readPairedOidc(db)).toBeNull();
    expect(logged.filter((line) => line.startsWith('[auth]'))).toEqual([]);
  });

  it('forgets the pairing even when the provider refuses to delete the client, and warns', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    dcr.deleteStatus = HttpStatus.InternalServerError;
    expect((await ok(UNPAIR)).unpairSso.source).toBe(SsoSource.None);
    expect(await readPairedOidc(db)).toBeNull();
    expect(await offered()).toEqual([]);
    expect(logged).toContainEqual(expect.stringMatching(/^\[auth\] .*could not confirm its client/));
  });

  it('forgets the pairing when the provider cannot be reached at all', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    await dcr.close();
    await ok(UNPAIR);
    expect(await readPairedOidc(db)).toBeNull();
    expect(logged).toContainEqual(expect.stringMatching(/^\[auth\] could not reach the OIDC provider/));
    // afterEach closes it again.
    dcr = await startFakeDcr();
  });
});

describe('the setup token', () => {
  it('is never stored, logged or answered, whether pairing works or fails', async () => {
    await refused(PAIR, { url: dcr.setupUrl(SPENT_TOKEN) });
    dcr.claimedIssuer = 'https://evil.example.com/oidc';
    await refused(PAIR, { url: dcr.setupUrl() });
    dcr.claimedIssuer = dcr.issuer;
    await ok(PAIR, { url: dcr.setupUrl() });
    const [row] = await db.select().from(oidcSettings);
    expect(JSON.stringify(row)).not.toContain(SETUP_TOKEN);

    dcr.deleteStatus = HttpStatus.InternalServerError;
    await ok(UNPAIR);
    // Spent by the first pairing.
    expect((await refused(PAIR, { url: dcr.setupUrl() })).reason).toBe(PairingFailure.Expired);
    // afterEach checks every line logged and every response sent.
    expect(logged.length + responses.length).toBeGreaterThan(0);
  });
});

/**
 * Walks the browser through a sign-in with the paired provider: the start route, the provider, the callback.
 *
 * @returns Where the callback sent the browser.
 */
async function signInWithOidc(): Promise<URL> {
  const start = await fetch(`${appUrl}/sso/${ProviderId.Oidc}`, { redirect: 'manual' });
  const authorizeUrl = locationOf(start).toString();
  const redirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri') ?? '';
  expect(redirectUri).toBe(`${appUrl}/api/auth/callback/${ProviderId.Oidc}`);
  const { code, state } = dcr.oidc.authorize(authorizeUrl);
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  return locationOf(await fetch(back, { redirect: 'manual', headers: { cookie: cookiesFrom(start) } }));
}

/**
 * Swaps the one-time token a sign-in landed with for its session, as the app's /auth/sso page does.
 *
 * @param location - Where the callback sent the browser.
 * @returns The session's token and user.
 */
async function verified(location: URL): Promise<{ token: string; userId: string }> {
  expect(`${location.origin}${location.pathname}`).toBe(`${appUrl}/auth/sso`);
  const { verifyOneTimeToken } = await ok(VERIFY, { token: location.searchParams.get('token') });
  return verifyOneTimeToken;
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

describe('signing in with the paired provider', () => {
  it('lands on /auth/sso with a one-time token that verifyOneTimeToken swaps for a session', async () => {
    await ok(PAIR, { url: dcr.setupUrl(SETUP_TOKEN, 'heautou') });
    const session = await verified(await signInWithOidc());
    const { getSession } = await ok(ME, {}, session.token);
    expect(getSession.user).toEqual({ id: session.userId, email: 'ada@example.com', name: 'Ada' });
    expect(await providersOf(session.userId)).toEqual([ProviderId.Oidc]);
    // The instance's first account, so its admin, who can now disconnect it.
    expect((await ok(SETUP, {}, session.token)).ssoSetup).toMatchObject({ canPair: true, issuer: dcr.issuer });
  });

  it.each([
    ['preferred_username', { preferred_username: 'ada.l' }, 'ada.l'],
    ["the address's local part", {}, 'ada'],
  ])('names a reader the provider gives no name by %s', async (_by, claims, name) => {
    dcr.oidc.profile = { sub: 'o-ada', email: 'ada@example.com', email_verified: true, ...claims };
    await ok(PAIR, { url: dcr.setupUrl() });
    const session = await verified(await signInWithOidc());
    expect((await ok(ME, {}, session.token)).getSession.user.name).toBe(name);
  });

  it('signs in to the account that has the address when the provider checked it', async () => {
    const admin = await makeAdmin('ada@example.com');
    await ok(PAIR, { url: dcr.setupUrl() }, admin.token);
    expect((await verified(await signInWithOidc())).userId).toBe(admin.id);
    expect(await providersOf(admin.id)).toEqual([ProviderId.Oidc]);
  });

  it.each([
    ['says it did not check it', { email_verified: false }],
    ['does not say', {}],
  ])('refuses an address an account already has when the provider %s', async (_says, claims) => {
    const admin = await makeAdmin('ada@example.com');
    await ok(PAIR, { url: dcr.setupUrl() }, admin.token);
    dcr.oidc.profile = { sub: 'o-mallory', email: 'ada@example.com', name: 'Mallory', ...claims };
    const location = await signInWithOidc();
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('account_not_linked');
    expect(location.searchParams.get('provider')).toBe(ProviderId.Oidc);
    expect(await providersOf(admin.id)).toEqual([]);
  });

  it('makes an account with the address not yet confirmed when the provider did not check a new address', async () => {
    await ok(PAIR, { url: dcr.setupUrl() });
    dcr.oidc.profile = { sub: 'o-ada', email: 'ada@example.com', name: 'Ada', email_verified: false };
    const session = await verified(await signInWithOidc());
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    expect(user).toMatchObject({ email: 'ada@example.com', emailVerified: false });
  });
});
