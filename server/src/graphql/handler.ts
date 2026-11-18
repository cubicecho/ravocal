import type { DB } from '@cubicecho/ravocal-db';
import type { Request } from 'express';
import { createYoga } from 'graphql-yoga';
import { isProduction } from '../core/config.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import { buildSchema } from '../schema/index.ts';
import { sessionUserId } from '../services/auth.ts';
import { graphqlLogger } from './logger.ts';
import { useOperationLimits } from './operation-limits.ts';

/** What Express hands Yoga alongside the fetch Request. */
interface ServerContext {
  /** The Express request. Absent when a test calls `yoga.fetch`. */
  req?: Request;
}

/** What every request's context is built from. */
export interface ContextDeps {
  db: DB;
}

/** Builds one request's context from its headers and the caller's address. */
export type ContextFactory = (headers: Headers, ip?: string) => Promise<Context>;

/**
 * Builds the context factory /graphql uses.
 *
 * @param deps - The database every resolver is given.
 * @returns The factory.
 */
export function createContextFactory({ db }: ContextDeps): ContextFactory {
  return async (headers, ip = UNKNOWN_IP) => ({
    db,
    userId: await sessionUserId(headers),
    ip,
    headers,
  });
}

/**
 * Builds the Yoga handler for /graphql.
 *
 * @param deps - The database resolvers are given.
 * @returns The Yoga instance, callable as Express middleware.
 */
export function createGraphQLHandler({ db }: ContextDeps) {
  const createContext = createContextFactory({ db });
  return createYoga<ServerContext, Context>({
    schema: buildSchema(),
    graphqlEndpoint: '/graphql',
    graphiql: isProduction() === false,
    // Same-origin in production, and through Vite's proxy in development. Yoga allows every origin by default.
    cors: false,
    // Masked errors are logged here with their real cause.
    logging: graphqlLogger,
    plugins: [useOperationLimits()],
    // Express's view of the client address, which honors `trust proxy`.
    context: ({ request, req }) => createContext(request.headers, req?.ip),
  });
}
