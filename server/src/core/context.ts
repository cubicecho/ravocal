import type { DB } from '@cubicecho/ravocal-db';
import type { Auth } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';

/** `Context.ip` when Express gave no address, as when a test calls `yoga.fetch`. */
export const UNKNOWN_IP = 'unknown';

/** Per-request GraphQL context. */
export interface Context {
  db: DB;
  /** The better-auth instance serving this request; the auth operations call `auth.api.*` on it. */
  auth: Auth;
  /** Sign-in throttle; every sign-in operation calls it first (auth/throttle.ts). */
  limiter: RateLimiter;
  /** Signed-in user, from the request's session, or null. Resolvers call requireAuth(ctx) rather than test this. */
  userId: string | null;
  /** Client address, as Express reads it under `trust proxy`. Keys the sign-in throttle. Never an identity. */
  ip: string;
  /** Request headers, where better-auth finds the session (`Authorization: Bearer`). */
  headers: Headers;
}
