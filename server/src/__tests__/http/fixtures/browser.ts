import { expect } from 'vitest';
import { HttpStatus } from '../../../core/wire.ts';

// What a test playing the browser through a provider's sign-in needs: the cookies it carries, and where it is sent.

/**
 * Reads the cookies a response set, as a request's Cookie header.
 *
 * @param response - The response.
 * @returns The header value.
 */
export function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/**
 * Reads where a redirect points.
 *
 * @param response - A 302.
 * @returns Its location.
 */
export function locationOf(response: Response): URL {
  expect(response.status).toBe(HttpStatus.Found);
  return new URL(response.headers.get('location') ?? '');
}
