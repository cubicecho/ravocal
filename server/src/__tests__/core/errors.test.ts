import { describe, expect, it } from 'vitest';
import { ErrorCode, errorMessage, requireAuth } from '../../core/errors.ts';

describe('errorMessage', () => {
  it('follows the cause chain, so a failed connect says why', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5436'), { code: 'ECONNREFUSED' });
    const aggregate = new AggregateError([refused, refused]);
    const failedQuery = new Error('Failed query: select 1', { cause: aggregate });
    expect(errorMessage(failedQuery)).toBe('Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5436');
  });

  it('gives an error with no message its code', () => {
    const coded = Object.assign(new Error(''), { code: 'ECONNRESET' });
    expect(errorMessage(coded)).toBe('ECONNRESET');
  });

  it('reads a thrown value that is not an Error', () => {
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('stops at a cause that points back at itself', () => {
    const looped = new Error('outer');
    looped.cause = looped;
    expect(errorMessage(looped)).toBe('outer');
  });
});

describe('requireAuth', () => {
  it('returns the signed-in user', () => {
    expect(requireAuth({ userId: 'u1' })).toBe('u1');
  });

  it.each([null, undefined, ''])('refuses %o as UNAUTHENTICATED', (userId) => {
    expect(() => requireAuth({ userId })).toThrow(
      expect.objectContaining({ message: 'Not authenticated', extensions: { code: ErrorCode.Unauthenticated } }),
    );
  });
});
