import type { DB } from '@cubicecho/ravocal-db';
import type { AuthHost } from '../auth/auth-host.ts';
import type { Auth } from '../auth/better-auth.ts';
import type { Mailer } from '../auth/email.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import type { Loaders } from '../graphql/loaders.ts';

/** `Context.ip` when Express gave no address, as when a test calls `yoga.fetch`. */
export const UNKNOWN_IP = 'unknown';

/** Per-request GraphQL context. */
export interface Context {
  db: DB;
  /** The better-auth instance serving this request, `authHost.current()`; the auth operations call `auth.api.*`. */
  auth: Auth;
  /** Where the auth instance comes from, and which providers it offers. */
  authHost: AuthHost;
  /** Sign-in throttle; every sign-in operation calls it first (auth/throttle.ts). */
  limiter: RateLimiter;
  /** Sends the invite and vote emails, once the write they announce has committed. */
  mailer: Mailer;
  /** Signed-in user, from the request's session, or null. Resolvers call requireAuth(ctx) rather than test this. */
  userId: string | null;
  /** Client address, as Express reads it under `trust proxy`. Keys the sign-in throttle. Never an identity. */
  ip: string;
  /** Request headers, where better-auth finds the session (`Authorization: Bearer`). */
  headers: Headers;
  /**
   * Adds a `Set-Cookie` to the response. Only the state cookie of a provider link (`linkSocialAccount`) is sent:
   * sessions are bearer tokens, never cookies.
   */
  setCookie: (cookie: string) => void;
  /** This request's batching for hand-written fields on list items (graphql/loaders.ts). */
  loaders: Loaders;
}
