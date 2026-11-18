import type { ContextValuesConfig, SchemaExclusions, SchemaFeatures, ScopeConfig } from '@vantreeseba/drizzle-graphql';
import type { Context } from '../core/context.ts';
import { requireAuth } from '../core/errors.ts';

// Rows are shared by group membership, not owned by one user: a member reads everything in their groups. `scope` is
// that lock, ANDed into every generated read, update and delete. Who may *change* a row they can read (the owner, or
// whoever made it) is narrower, and is graphql-casl's job in permissions.ts.

/** better-auth's own tables. Never exposed: they hold session tokens and provider credentials. */
export const AUTH_TABLES = ['sessions', 'accounts', 'verifications'] as const;

/** Tables only the server reads, because they hold a secret. None yet. */
export const SERVER_TABLES: readonly string[] = [];

/** What the schema leaves out entirely. */
export const exclude: SchemaExclusions = {
  tables: [...AUTH_TABLES, ...SERVER_TABLES],
  // An invite's token is its link, and whoever holds the link joins. It leaves the server only by email.
  columns: { groupInvites: ['token'] },
};

/** A filter over `groups`, in the generated `where` dialect. */
type GroupFilter = Record<string, unknown>;

/**
 * The groups the caller is a member of.
 *
 * @param context - Request context.
 * @returns A `groups` filter.
 * @throws UNAUTHENTICATED when nobody is signed in.
 */
const callersGroups = (context: Context): GroupFilter => ({
  members: { some: { userId: { eq: requireAuth(context) } } },
});

/**
 * Rows of a group the caller is a member of, for a table with a `group` relation.
 *
 * @param context - Request context.
 * @returns The filter.
 */
const inCallersGroup = (context: Context) => ({ group: callersGroups(context) });

/** Row scope per table, by Drizzle schema key. tenancy.test.ts fails when an exposed table has none. */
export const scope: ScopeConfig<Context> = {
  // Yourself, and anyone you share a group with.
  users: (context) => ({
    OR: [{ id: { eq: requireAuth(context) } }, { groupMemberships: { some: { group: callersGroups(context) } } }],
  }),
  groups: callersGroups,
  groupMembers: inCallersGroup,
  // Only the owner sees who was invited.
  groupInvites: (context) => ({ group: { ownerId: { eq: requireAuth(context) } } }),
  timeBlocks: inCallersGroup,
  votes: inCallersGroup,
  voteSlots: (context) => ({ vote: inCallersGroup(context) }),
  // Your own ballot, in a group you are still in.
  voteRankings: (context) => ({ userId: { eq: requireAuth(context) }, vote: inCallersGroup(context) }),
};

/** Who a row belongs to, stamped from the request and removed from every input, so it is never caller-stated. */
export const contextValues: ContextValuesConfig<Context> = {
  timeBlocks: { userId: requireAuth },
  // createGroup is hand-written, so this only takes ownerId out of the update: a group can't be handed away.
  groups: { ownerId: requireAuth },
};

/** The tables each generated write is offered on. Every other write is hand-written, in its domain folder. */
const GENERATED_WRITES = {
  insert: new Set<string>(['timeBlocks']),
  update: new Set<string>(['users', 'groups', 'timeBlocks']),
  delete: new Set<string>(['groups', 'timeBlocks']),
};

/** Which generated writes exist, per table. permissions.ts then allows only their single-row forms. */
export const features: SchemaFeatures = {
  insert: (table) => GENERATED_WRITES.insert.has(table),
  update: (table) => GENERATED_WRITES.update.has(table),
  delete: (table) => GENERATED_WRITES.delete.has(table),
  // Every write here is one row; the batch form would only be one more door to shut.
  updateMany: false,
  // The default, stated: the hooks read the root field's args, so a nested child would be checked as its parent.
  nestedWrites: false,
};
