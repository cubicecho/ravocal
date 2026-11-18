import { type DB, db, groupMembers, groups, migrateDb, schema, users } from '@cubicecho/ravocal-db';
import { PGlite } from '@electric-sql/pglite';
import { getTableName, is, sql, Table } from 'drizzle-orm';
import { type ExecutionResult, type GraphQLSchema, graphql } from 'graphql';
import type { Context } from '../context.ts';
import { buildSchema } from '../schema/index.ts';

/** Every table in the schema, quoted for one statement that empties them all. */
const TABLE_LIST = Object.values(schema)
  .flatMap((value) => (is(value, Table) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

/** A GraphQL response's `data`, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own query asked for
type AnyData = any;
type Variables = Record<string, unknown>;

/**
 * Migrates the @cubicecho/ravocal-db singleton and hands it back.
 *
 * @remarks
 * vitest.config.ts sets `DATABASE_URL=memory://`, and each test file gets its
 * own module graph, so the singleton is a throwaway in-memory PGlite per file.
 * Using it rather than a second instance tests the connection exactly as the
 * server builds it.
 *
 * @returns The migrated db.
 * @throws If the singleton is not in memory, so a test never migrates a real database.
 */
export async function openTestDb(): Promise<DB> {
  if (process.env.DATABASE_URL !== 'memory://') {
    throw new Error('Tests need DATABASE_URL=memory:// (see vitest.config.ts).');
  }
  await migrateDb();
  return db;
}

/**
 * Empties every table, so each test starts from a freshly migrated db.
 *
 * @param testDb - The db from `openTestDb`.
 */
export async function resetTestDb(testDb: DB): Promise<void> {
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${TABLE_LIST} RESTART IDENTITY CASCADE`));
}

/**
 * Shuts the db down at the end of a file.
 *
 * @param testDb - The db from `openTestDb`.
 * @throws If the db is not PGlite, which `openTestDb` rules out.
 */
export async function closeTestDb(testDb: DB): Promise<void> {
  // `DB` covers both drivers, so the PGlite client behind it isn't on the type.
  const client: unknown = Reflect.get(testDb, '$client');
  if (!(client instanceof PGlite)) {
    throw new Error('Expected the in-memory PGlite test db.');
  }
  await client.close();
}

/**
 * Inserts a user straight through Drizzle. Sign-in isn't under test.
 *
 * @param testDb - Test db.
 * @param email - The user's email.
 * @returns The user id.
 */
export async function createUser(testDb: DB, email: string): Promise<string> {
  const [user] = await testDb.insert(users).values({ email }).returning();
  return user.id;
}

/**
 * Inserts a group with its owner as a member, the way `createGroup` leaves it.
 *
 * @param testDb - Test db.
 * @param ownerId - The owner.
 * @param overlapThreshold - Percent of members a normal vote needs free.
 * @returns The group id.
 */
export async function createGroup(testDb: DB, ownerId: string, overlapThreshold = 50): Promise<string> {
  const [group] = await testDb.insert(groups).values({ name: 'Book club', ownerId, overlapThreshold }).returning();
  await addMember(testDb, group.id, ownerId);
  return group.id;
}

/**
 * Adds a user to a group directly. Invites aren't under test.
 *
 * @param testDb - Test db.
 * @param groupId - The group.
 * @param userId - The new member.
 */
export async function addMember(testDb: DB, groupId: string, userId: string): Promise<void> {
  await testDb.insert(groupMembers).values({ groupId, userId });
}

/** A GraphQL client bound to one caller. */
export interface TestClient {
  /** Executes an operation in-process and returns the raw result. */
  run: (query: string, variables?: Variables) => Promise<ExecutionResult>;
  /** Runs and returns `data`. Throws the first error's original cause, so a failure reads as the real bug. */
  expectOk: (query: string, variables?: Variables) => Promise<AnyData>;
  /** Runs and returns the first error's message. Throws on success. */
  expectError: (query: string, variables?: Variables) => Promise<string>;
}

let cachedSchema: GraphQLSchema | undefined;

/**
 * Builds a client that runs operations against the real schema as one caller.
 *
 * @param testDb - Test db.
 * @param userId - The caller, or null for anonymous.
 * @returns The client.
 */
export function createClient(testDb: DB, userId: string | null): TestClient {
  cachedSchema ??= buildSchema();
  const schemaForRun = cachedSchema;

  const run: TestClient['run'] = (query, variables) => {
    const contextValue: Context = { db: testDb, userId };
    return graphql({
      schema: schemaForRun,
      source: query,
      contextValue,
      variableValues: variables,
    });
  };

  const expectOk: TestClient['expectOk'] = async (query, variables) => {
    const result = await run(query, variables);
    const [first] = result.errors ?? [];
    if (first !== undefined) {
      throw first.originalError ?? first;
    }
    return result.data;
  };

  const expectError: TestClient['expectError'] = async (query, variables) => {
    const result = await run(query, variables);
    const [first] = result.errors ?? [];
    if (first === undefined) {
      throw new Error('Expected an error, got a successful result.');
    }
    return first.message;
  };

  return { run, expectOk, expectError };
}
