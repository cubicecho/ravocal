import type { Server } from 'node:http';
import { relations } from '@cubicecho/ravocal-db/relations';
import * as dbSchema from '@cubicecho/ravocal-db/schema';
import { PGlite } from '@electric-sql/pglite';
import { getTableName, is, sql, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { type ExecutionResult, type GraphQLSchema, graphql } from 'graphql';
import { inject } from 'vitest';
import type { Context } from '../core/context.ts';
import { buildSchema } from '../schema/index.ts';

// Never import the db package root here: it needs DATABASE_URL and connects to a real Postgres.

/**
 * A drizzle db over PGlite.
 *
 * @remarks
 * PGlite's client runs the same queries as the postgres-js one the server's `DB` names, but it is a
 * different type. This alias is the one place that gap is bridged.
 */
// biome-ignore lint/suspicious/noExplicitAny: see the remark above
export type TestDb = any;
/** A GraphQL response's `data`, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own query asked for
type AnyData = any;
/** Variables for one operation. */
type Variables = Record<string, unknown>;

declare module 'vitest' {
  interface ProvidedContext {
    /** The DDL for the current models, worked out once per run by `global-setup.ts`. */
    schemaSql: string[];
  }
}

/** The address a client's requests come from. */
export const TEST_IP = '127.0.0.1';

/** Every table in the schema, quoted for one statement that empties them all. */
const TABLE_LIST = Object.values(dbSchema)
  .flatMap((value) => (is(value, Table) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

/**
 * Builds a fresh in-memory Postgres with the models' schema in it.
 *
 * @remarks
 * Booting one is the expensive part of a suite. A file makes it in `beforeAll`, empties it with
 * `resetTestDb` between tests, and hands it to `closeTestDb` when it is done.
 *
 * @returns The db.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite('memory://');
  for (const statement of inject('schemaSql')) {
    await client.exec(statement);
  }
  return drizzle({ client, relations });
}

/**
 * Empties every table, so the next test starts from the db `createTestDb` returned.
 *
 * @param testDb - Test db.
 */
export async function resetTestDb(testDb: TestDb): Promise<void> {
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${TABLE_LIST} RESTART IDENTITY CASCADE`));
}

/**
 * Shuts a test db down. An instance left open holds its whole Postgres in memory until the worker exits.
 *
 * @param testDb - Test db.
 */
export async function closeTestDb(testDb: TestDb): Promise<void> {
  await testDb.$client.close();
}

/**
 * Inserts a user straight through Drizzle. Sign-in isn't under test.
 *
 * @param testDb - Test db.
 * @param email - The user's email.
 * @returns The user id.
 */
export async function createUser(testDb: TestDb, email: string): Promise<string> {
  const [user] = await testDb.insert(dbSchema.users).values({ email }).returning();
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
export async function createGroup(testDb: TestDb, ownerId: string, overlapThreshold = 50): Promise<string> {
  const [group] = await testDb
    .insert(dbSchema.groups)
    .values({ name: 'Book club', ownerId, overlapThreshold })
    .returning();
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
export async function addMember(testDb: TestDb, groupId: string, userId: string): Promise<void> {
  await testDb.insert(dbSchema.groupMembers).values({ groupId, userId });
}

/** What `expectError` hands back. */
export interface RefusedOperation {
  message: string;
  /** `extensions.code`, to compare with `ErrorCode`. */
  code: unknown;
}

/** A GraphQL client bound to one caller. */
export interface TestClient {
  /** Executes an operation in-process and returns the raw result. */
  run: (query: string, variables?: Variables) => Promise<ExecutionResult>;
  /** Runs and returns `data`. Throws the first error's original cause, so a failure reads as the real bug. */
  expectOk: (query: string, variables?: Variables) => Promise<AnyData>;
  /** Runs and returns the first error. Throws on success. */
  expectError: (query: string, variables?: Variables) => Promise<RefusedOperation>;
}

let cachedSchema: GraphQLSchema | undefined;

/**
 * Builds a client that runs operations against the real schema as one caller.
 *
 * @param testDb - Test db.
 * @param userId - The caller, or null for anonymous.
 * @returns The client.
 */
export function createClient(testDb: TestDb, userId: string | null): TestClient {
  cachedSchema ??= buildSchema();
  const schemaForRun = cachedSchema;

  const run: TestClient['run'] = (query, variables) => {
    const contextValue: Context = { db: testDb, userId, ip: TEST_IP, headers: new Headers() };
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
    return { message: first.message, code: first.extensions.code };
  };

  return { run, expectOk, expectError };
}

/**
 * Reads the port a test server was given.
 *
 * @param server - A server listening on port 0.
 * @returns The port the OS picked.
 * @throws If the server is not listening on a TCP port.
 */
export function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test server is not listening on a TCP port.');
  }
  return address.port;
}
