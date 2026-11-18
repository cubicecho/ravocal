import {
  type Action,
  Actions,
  accept,
  applyPermissions,
  createCan,
  createGraphQLAbility,
  deny,
  type PermissionsMap,
  type Rule,
  rule,
  wrap,
} from '@vantreeseba/graphql-casl';
import { scopeArgs } from '@vantreeseba/graphql-casl/scoping';
import type { GraphQLSchema } from 'graphql';
import { BETTER_AUTH_OPERATIONS } from '../auth/endpoints.ts';
import type { Context } from '../core/context.ts';
import { forbidden, requireAuth, unauthenticated } from '../core/errors.ts';
import { drizzleFilters } from './drizzle-filters.ts';
import { objectType } from './object-type.ts';

// `scope` (tenancy.ts) decides which rows a caller can see, and it applies to writes too: a member can only ever touch
// rows in their own groups. It can't tell a read from a write, though, and a member may read a row they may not
// change. graphql-casl is that second, narrower lock: each generated write's `where` is ANDed with the caller's
// conditions, so another member's row matches nothing and answers NOT_FOUND, exactly like a row in another group.

/** The GraphQL types a generated write is narrowed on. */
type SubjectName = 'Group' | 'TimeBlock' | 'User';
/** What casl checks conditions against. Every condition is on a column of the type itself. */
type Subjects = Record<SubjectName, Record<string, unknown>>;

/**
 * Builds what a signed-in caller may change, among the rows they can already see.
 *
 * @param userId - The caller.
 * @returns The casl ability.
 */
function abilitiesFor(userId: string) {
  const { can, build } = createGraphQLAbility<Subjects>();
  // Renaming a group, its threshold, and deleting it are the owner's.
  can([Actions.update, Actions.delete], 'Group', { ownerId: userId });
  // A time block is changed or removed by whoever marked it.
  can([Actions.update, Actions.delete], 'TimeBlock', { userId });
  // Your own row, and nobody else's.
  can(Actions.update, 'User', { id: userId });
  return build();
}

/** Rule factory over the caller's ability. */
const canUser = createCan<Context, Subjects>(
  async (context) => abilitiesFor(requireAuth(context)),
  (context) => context.userId !== null,
);

/** Signed-in callers only, refused as UNAUTHENTICATED so the app signs in again. The resolver decides the rest. */
const signedIn = rule((_parent, _args, context: Context) => (context.userId === null ? unauthenticated() : true), {
  name: 'signedIn',
});

/**
 * Narrows a generated single-row write to the rows the caller may change.
 *
 * @param action - What the write does.
 * @param subject - The type it writes.
 * @returns The rule. A row it filters out leaves the write matching nothing, which build-schema.ts answers NOT_FOUND.
 */
const narrowedTo = (action: Action, subject: SubjectName): Rule =>
  wrap(signedIn, scopeArgs(canUser, action, subject, { adapter: drizzleFilters }));

/** The hand-written writes. Each checks the rest itself (owner, member, invite holder): here they only need a caller. */
const HAND_WRITTEN_MUTATIONS = [
  'createGroup',
  'removeMember',
  'inviteToGroup',
  'acceptGroupInvite',
  'cancelInvite',
  'startVote',
  'forceStartVote',
  'submitRankings',
  'closeVote',
];

/** The generated writes that are served. Every other one, the bulk forms included, is refused. */
const GENERATED_MUTATIONS: Record<string, Rule> = {
  // A new block's group is checked by its hook, and its owner is the caller (contextValues).
  createTimeBlock: signedIn,
  updateTimeBlock: narrowedTo(Actions.update, 'TimeBlock'),
  deleteTimeBlock: narrowedTo(Actions.delete, 'TimeBlock'),
  updateGroup: narrowedTo(Actions.update, 'Group'),
  deleteGroup: narrowedTo(Actions.delete, 'Group'),
  updateUser: narrowedTo(Actions.update, 'User'),
};

/**
 * Lists better-auth's mutations the schema serves. Its queries are open like every other query.
 *
 * @param schema - The schema being guarded.
 * @returns The served auth operations that are mutations.
 */
function authMutations(schema: GraphQLSchema): string[] {
  const fields = objectType(schema, 'Mutation').getFields();
  return BETTER_AUTH_OPERATIONS.filter((name) => name in fields);
}

/**
 * Builds the schema's permission map.
 *
 * @param schema - The schema it will guard; its served auth mutations are read off it.
 * @returns The map.
 */
export function permissionsFor(schema: GraphQLSchema): PermissionsMap {
  // Signing in is for callers who aren't yet.
  const signIn = authMutations(schema).map((name) => [name, accept]);
  const handWritten = HAND_WRITTEN_MUTATIONS.map((name) => [name, signedIn]);
  return {
    // Reads are confined by `scope`, which refuses an anonymous caller itself. authConfig and getSession are open.
    '*': accept,
    Mutation: {
      // An allow-list: a write a new table generates arrives shut, and so does every bulk form.
      '*': deny,
      ...Object.fromEntries([...signIn, ...handWritten]),
      ...GENERATED_MUTATIONS,
    },
  };
}

/**
 * Guards a schema with the permission map.
 *
 * @param schema - The fully extended schema.
 * @returns The guarded schema.
 */
export function applyAppPermissions(schema: GraphQLSchema): GraphQLSchema {
  return applyPermissions(schema, permissionsFor(schema), {
    // A refusal the map makes is a kind of caller that may never do this. A row they can't touch is NOT_FOUND instead.
    fallbackError: () => forbidden('You are not allowed to do that.'),
  });
}
