import { describe, expect, it } from 'vitest';
import { type Queryable, waitForDatabase } from '../wait.ts';

/** Settings small enough that a test never waits long. */
const FAST = { firstRetryDelayMs: 1, maxRetryDelayMs: 2, connectTimeoutMs: 50 };

/**
 * Builds a db whose first queries fail with the given errors, then succeed.
 *
 * @param failures - What each attempt throws, in order.
 * @returns The db, and how many queries it has run.
 */
function flakyDb(failures: unknown[]): { db: Queryable; attempts: () => number } {
  let count = 0;
  const db: Queryable = {
    execute: async () => {
      const failure = failures[count];
      count += 1;
      if (failure !== undefined) {
        throw failure;
      }
      return [];
    },
  };
  return { db, attempts: () => count };
}

/**
 * Builds the error postgres-js throws: the socket error is on `cause`.
 *
 * @param code - The socket or Postgres error code.
 * @returns The error.
 */
function connectError(code: string): Error {
  return new Error('connect failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('waitForDatabase', () => {
  it('retries a refused connection until Postgres answers', async () => {
    const { db, attempts } = flakyDb([connectError('ECONNREFUSED'), connectError('57P03')]);
    await waitForDatabase(db, FAST, () => {});
    expect(attempts()).toBe(3);
  });

  it('fails at once on bad credentials', async () => {
    const badPassword = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const { db, attempts } = flakyDb([badPassword]);
    await expect(waitForDatabase(db, FAST, () => {})).rejects.toBe(badPassword);
    expect(attempts()).toBe(1);
  });

  it('fails at once on a missing database', async () => {
    const missing = Object.assign(new Error('database "nope" does not exist'), { code: '3D000' });
    const { db, attempts } = flakyDb([missing]);
    await expect(waitForDatabase(db, FAST, () => {})).rejects.toBe(missing);
    expect(attempts()).toBe(1);
  });

  it('gives up with the last error once the budget runs out', async () => {
    const refused = connectError('ECONNREFUSED');
    const { db } = flakyDb(Array.from({ length: 1000 }, () => refused));
    await expect(waitForDatabase(db, { ...FAST, connectTimeoutMs: 5 }, () => {})).rejects.toBe(refused);
  });
});
