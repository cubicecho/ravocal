import type { DB } from '@cubicecho/ravocal-db';
import type { Request, Response } from 'express';
import { createYoga } from 'graphql-yoga';
import type { AuthHost } from '../auth/auth-host.ts';
import { sessionUserId } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { isProduction } from '../core/config.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import { buildSchema } from '../schema/index.ts';
import { graphqlLogger } from './logger.ts';
import { useOperationLimits } from './operation-limits.ts';

/** What Express hands Yoga alongside the fetch Request. */
interface ServerContext {
  /** The Express request. Absent when a test calls `yoga.fetch`. */
  req?: Request;
  /** The Express response, which a cookie an operation sets is added to. Absent when a test calls `yoga.fetch`. */
  res?: Response;
}

/** What every request's context is built from. */
export interface ContextDeps {
  db: DB;
  /** Where each request's auth instance comes from. It reads the session and serves the auth operations. */
  authHost: AuthHost;
  /** Sign-in throttle the auth operations call. */
  limiter: RateLimiter;
}

/**
 * Builds one request's context from its headers, the caller's address, and where a cookie an operation sets goes
 * (nowhere, by default).
 */
export type ContextFactory = (headers: Headers, ip?: string, setCookie?: (cookie: string) => void) => Promise<Context>;

/**
 * Builds the context factory /graphql uses. It is the one place a request's caller is read.
 *
 * @param deps - The database, the auth host and the sign-in limiter every resolver is given.
 * @returns The factory.
 */
export function createContextFactory({ db, authHost, limiter }: ContextDeps): ContextFactory {
  return async (headers, ip = UNKNOWN_IP, setCookie = () => {}) => {
    // Asked per request: a rebuild swaps the instance while the server runs.
    const auth = authHost.current();
    return {
      db,
      auth,
      authHost,
      limiter,
      userId: await sessionUserId(auth, headers),
      ip,
      headers,
      setCookie,
    };
  };
}

/**
 * Builds the Yoga handler for /graphql.
 *
 * @param deps - The database, the auth host and the sign-in limiter.
 * @returns The Yoga instance, callable as Express middleware.
 */
export function createGraphQLHandler(deps: ContextDeps) {
  const createContext = createContextFactory(deps);
  return createYoga<ServerContext, Context>({
    schema: buildSchema(deps.db),
    graphqlEndpoint: '/graphql',
    graphiql: isProduction() === false,
    // Same-origin in production, and through Vite's proxy in development. Yoga allows every origin by default.
    cors: false,
    // Masked errors are logged here with their real cause.
    logging: graphqlLogger,
    plugins: [useOperationLimits()],
    // Express's view of the client address, which honors `trust proxy`. A cookie goes on the Express response, whose
    // headers Yoga adds its own to.
    context: ({ request, req, res }) =>
      createContext(request.headers, req?.ip, (cookie) => res?.append('set-cookie', cookie)),
  });
}
