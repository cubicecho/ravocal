import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from '@cubicecho/ravocal-db';
import { makeExecutableSchema } from '@graphql-tools/schema';
import type { GraphQLSchema } from 'graphql';
import { DateTimeResolver } from 'graphql-scalars';
import { applyBetterAuthExtension } from '../auth/endpoints.ts';
import { applyAuthExtension } from '../auth/resolvers.ts';
import { applyGroupResolvers } from './resolvers/groups.ts';
import { applyTimeBlockResolvers } from './resolvers/time-blocks.ts';
import { applyVoteResolvers, voteFields } from './resolvers/votes.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typeDefs = readFileSync(join(__dirname, '../schema.graphql'), 'utf-8');

/**
 * Builds the served schema: the hand-written SDL and its resolvers, then `authConfig` and better-auth's endpoints.
 *
 * @param db - The database better-auth's endpoints are described over. Resolvers query `ctx.db`.
 * @returns The schema.
 */
export function buildSchema(db: DB): GraphQLSchema {
  const queryFields: Record<string, unknown> = {};
  const mutationFields: Record<string, unknown> = {};

  applyGroupResolvers(queryFields, mutationFields);
  applyTimeBlockResolvers(queryFields, mutationFields);
  applyVoteResolvers(queryFields, mutationFields);

  const handWritten = makeExecutableSchema({
    typeDefs,
    resolvers: {
      DateTime: DateTimeResolver,
      Query: queryFields,
      Mutation: mutationFields,
      Vote: voteFields,
    },
  });
  return applyBetterAuthExtension(applyAuthExtension(handWritten), db);
}
