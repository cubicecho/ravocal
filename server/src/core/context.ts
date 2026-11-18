import type { DB } from '@cubicecho/ravocal-db';

/** `Context.ip` when Express gave no address, as when a test calls `yoga.fetch`. */
export const UNKNOWN_IP = 'unknown';

/** Per-request GraphQL context. */
export interface Context {
  db: DB;
  /** Signed-in user, or null. Resolvers call requireAuth(ctx) rather than test this. */
  userId: string | null;
  /** Client address, as Express reads it under `trust proxy`. Never an identity. */
  ip: string;
  /** Request headers. */
  headers: Headers;
}
