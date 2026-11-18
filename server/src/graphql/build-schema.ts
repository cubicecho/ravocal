import type { DB } from '@cubicecho/ravocal-db';
import { buildSchema, drizzleExtension, isDrizzleFieldExtension } from '@vantreeseba/drizzle-graphql';
import type { GraphQLFieldResolver, GraphQLSchema } from 'graphql';
import { applyBetterAuthExtension } from '../auth/endpoints.ts';
import { applyAuthExtension } from '../auth/resolvers.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { notFound } from '../core/errors.ts';
import { groupWriteHooks } from '../groups/hooks.ts';
import { applyGroupsExtension } from '../groups/resolvers.ts';
import { applyInvitesExtension } from '../invites/resolvers.ts';
import { timeBlockWriteHooks } from '../time-blocks/hooks.ts';
import { userWriteHooks } from '../users/hooks.ts';
import { applyVotesExtension } from '../votes/resolvers.ts';
import { objectType } from './object-type.ts';
import { applyAppPermissions } from './permissions.ts';
import { contextValues, exclude, features, scope } from './tenancy.ts';

/** The generated writes that target one row, and answer null when their `where` matched none. */
const SINGLE_ROW_WRITES = new Set<string>(['update', 'delete']);

/**
 * Builds the served schema: drizzle-graphql's CRUD over the tables, the hand-written fields, then the permission map.
 *
 * @param db - Drizzle client: postgres-js in production, PGlite in tests.
 * @returns The guarded schema.
 */
export function createSchema(db: DB): { schema: GraphQLSchema } {
  const { schema: generated } = buildSchema(db, {
    prefixes: { insert: 'create', update: 'update', delete: 'delete' },
    // Table keys are plural (`timeBlocks`). Types and single-row fields are singular (TimeBlock, timeBlock).
    typeNameMapper: 'singularize',
    // Confines every generated read, update and delete to the caller's groups.
    scope,
    // Who a row belongs to: removed from inputs and stamped from the request.
    contextValues,
    // Which generated writes exist, per table. Nested writes are off.
    features,
    // better-auth's tables, and the invite token.
    exclude,
    // Inside each mutation's transaction. Each domain folder exports its table's.
    onWrite: { ...groupWriteHooks, ...timeBlockWriteHooks, ...userWriteHooks },
    // The order a list comes back in when the request names none.
    defaults: {
      // Ballot order, which a forced vote decides: the owner's free slots first.
      voteSlots: { orderBy: { position: 'asc' } },
      // Newest first, so `votes(limit: 1)` is a group's current or latest vote.
      votes: { orderBy: { createdAt: 'desc' } },
      timeBlocks: { orderBy: { startsAt: 'asc' } },
      groupMembers: { orderBy: { joinedAt: 'asc' } },
    },
    // Every list, root or relation, gets a page.
    limits: {
      defaultLimit: OPERATION_LIMIT_DEFAULTS.defaultPageSize,
      maxLimit: OPERATION_LIMIT_DEFAULTS.maxPageSize,
    },
    // Publishes each field's cost for useOperationLimits. On by default, and stated so nobody turns it off.
    complexity: true,
    // Coded errors pass as they are. Anything else goes on to Yoga, which masks it and logs its cause ([graphql]):
    // drizzle-graphql's own sanitizer would answer it as a coded error, and the cause would never be logged.
    onError: (error) => (error instanceof Error ? error : undefined),
  });

  const withNotFound = answerMissingRowsNotFound(generated);
  // authConfig, then better-auth's own endpoints.
  const withAuth = applyBetterAuthExtension(applyAuthExtension(withNotFound), db);
  const extended = applyVotesExtension(applyInvitesExtension(applyGroupsExtension(withAuth)));
  return { schema: applyAppPermissions(extended) };
}

/**
 * Makes each generated single-row update and delete refuse with NOT_FOUND when its `where` matched no row.
 *
 * @remarks
 * drizzle-graphql answers null there. A row outside the caller's groups (`scope`) and one they may read but not change
 * (permissions.ts) both match nothing, and so does an id that never existed: all three are the same NOT_FOUND, so a
 * caller can't tell them apart.
 *
 * @param schema - The generated schema. Its resolvers are replaced in place.
 * @returns The same schema.
 */
function answerMissingRowsNotFound(schema: GraphQLSchema): GraphQLSchema {
  for (const field of Object.values(objectType(schema, 'Mutation').getFields())) {
    const generated = drizzleExtension(field);
    const { resolve } = field;
    const isSingleRowWrite =
      isDrizzleFieldExtension(generated) && generated.single && SINGLE_ROW_WRITES.has(generated.operation);
    if (isSingleRowWrite && resolve !== undefined) {
      const refusal = `${field.type.toString().replace(/!$/, '')} not found`;
      const found: GraphQLFieldResolver<unknown, unknown> = async (...args) => {
        const row = await resolve(...args);
        // null in the schema's terms; the resolver itself hands back undefined.
        const isMissing = row === null || row === undefined;
        if (isMissing) {
          throw notFound(refusal);
        }
        return row;
      };
      field.resolve = found;
    }
  }
  return schema;
}
