import { GraphQLError } from 'graphql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter, type RateLimiter } from '../../auth/rate-limit.ts';
import { RATE_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';
import { closeTestDb, createClient, createTestDb, resetTestDb, TEST_IP, type TestDb } from '../helpers.ts';

const REQUEST = 'mutation ($email: String!) { signInMagicLink(email: $email) { status } }';
const VERIFY = 'mutation ($token: String!) { magicLinkVerify(token: $token) { token } }';

const SETTINGS = { maxAttempts: 2, windowMinutes: 1 };
const WINDOW_SECONDS = SETTINGS.windowMinutes * SECONDS_PER_MINUTE;
const WINDOW_MS = WINDOW_SECONDS * MS_PER_SECOND;
/** A moment inside the window, in seconds after the first attempt. */
const LATER_SECONDS = 20;

let clock: number;
let limiter: RateLimiter;

beforeEach(() => {
  clock = 0;
  limiter = createRateLimiter(SETTINGS, () => clock);
});

/**
 * Makes one attempt.
 *
 * @param keys - The keys it counts against.
 * @returns The refusal's `extensions`, or undefined when the attempt was let through.
 */
function refusal(...keys: string[]): Record<string, unknown> | undefined {
  try {
    limiter.hit(...keys);
    return undefined;
  } catch (error) {
    if (error instanceof GraphQLError) {
      return error.extensions;
    }
    throw error;
  }
}

describe('createRateLimiter', () => {
  it('lets a key through up to its budget, then refuses with the wait', () => {
    expect(refusal('a')).toBeUndefined();
    clock = LATER_SECONDS * MS_PER_SECOND;
    expect(refusal('a')).toBeUndefined();
    // The first attempt, at 0, leaves the window one window after it was made.
    expect(refusal('a')).toEqual({ code: ErrorCode.TooManyRequests, retryAfter: WINDOW_SECONDS - LATER_SECONDS });
  });

  it('counts keys separately', () => {
    limiter.hit('a');
    limiter.hit('a');
    expect(refusal('b')).toBeUndefined();
  });

  it('slides: an attempt is forgotten one window after it was made', () => {
    limiter.hit('a');
    clock = WINDOW_MS / 2;
    limiter.hit('a');
    clock = WINDOW_MS;
    expect(refusal('a')).toBeUndefined();
    expect(refusal('a')).toBeDefined();
  });

  it('refuses when any one key is spent, and charges none of them', () => {
    limiter.hit('ip');
    limiter.hit('ip');
    expect(refusal('ip', 'email')).toBeDefined();
    expect(refusal('email')).toBeUndefined();
    expect(refusal('email')).toBeUndefined();
  });

  it('does not let refused attempts hold the door shut', () => {
    limiter.hit('a');
    limiter.hit('a');
    clock = WINDOW_MS - 1;
    expect(refusal('a')).toBeDefined();
    clock = WINDOW_MS;
    expect(refusal('a')).toBeUndefined();
  });

  it('forgets quiet keys once it holds too many', () => {
    const small = createRateLimiter({ ...SETTINGS, maxAttempts: 1, sweepAtKeys: 2 }, () => clock);
    small.hit('a');
    small.hit('b');
    clock = WINDOW_MS;
    // The third key trips the sweep, and `a` and `b` have aged out.
    small.hit('c');
    expect(() => small.hit('a')).not.toThrow();
  });

  it('keeps the default for a setting the overrides leave out', () => {
    const defaults = createRateLimiter({ windowMinutes: 1 }, () => 0);
    for (let attempt = 0; attempt < RATE_LIMIT_DEFAULTS.maxAttempts; attempt += 1) {
      defaults.hit('k');
    }
    expect(() => defaults.hit('k')).toThrow();
  });
});

describe('sign-in throttling', () => {
  const { maxAttempts } = RATE_LIMIT_DEFAULTS;
  let db: TestDb;
  let addresses = 0;
  const nextEmail = () => `throttled${++addresses}@example.com`;
  /** A distinct address for each attempt, from the documentation range. */
  const ipFor = (attempt: number) => `198.51.100.${attempt + 1}`;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
  });

  it(`refuses the attempt after the ${maxAttempts}th from one address, whichever email it names`, async () => {
    const throttled = createRateLimiter();
    const client = createClient(db, null, { limiter: throttled, ip: TEST_IP });
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await client.expectOk(REQUEST, { email: nextEmail() });
    }
    const { code, extensions } = await client.expectError(REQUEST, { email: nextEmail() });
    expect(code).toBe(ErrorCode.TooManyRequests);
    expect(extensions.retryAfter).toBe(RATE_LIMIT_DEFAULTS.windowMinutes * SECONDS_PER_MINUTE);
  });

  it(`refuses the attempt after the ${maxAttempts}th for one email, whichever address asks`, async () => {
    const throttled = createRateLimiter();
    const email = nextEmail();
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // One account in several spellings, so normalizing is what makes them one key.
      const spelling = attempt % 2 === 0 ? email : ` ${email.toUpperCase()} `;
      await createClient(db, null, { limiter: throttled, ip: ipFor(attempt) }).expectOk(REQUEST, { email: spelling });
    }
    const last = createClient(db, null, { limiter: throttled, ip: ipFor(maxAttempts) });
    const { code } = await last.expectError(REQUEST, { email });
    expect(code).toBe(ErrorCode.TooManyRequests);
  });

  it('limits verifying a link, valid or not, by address', async () => {
    const client = createClient(db, null, { limiter });
    expect((await client.expectError(VERIFY, { token: 'not-a-token' })).code).toBe(ErrorCode.BadUserInput);
    expect((await client.expectError(VERIFY, { token: 'nor-this' })).code).toBe(ErrorCode.BadUserInput);
    const { code } = await client.expectError(VERIFY, { token: 'a-third' });
    expect(code).toBe(ErrorCode.TooManyRequests);
  });

  it('gives requesting and verifying a budget each', async () => {
    const client = createClient(db, null, { limiter });
    await client.expectOk(REQUEST, { email: nextEmail() });
    await client.expectOk(REQUEST, { email: nextEmail() });
    const { code } = await client.expectError(VERIFY, { token: 'not-a-token' });
    expect(code).toBe(ErrorCode.BadUserInput);
  });
});
