import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter, type RateLimiter } from '../../auth/rate-limit.ts';
import { RATE_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';

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
