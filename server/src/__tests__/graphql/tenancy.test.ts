import * as dbSchema from '@cubicecho/ravocal-db/schema';
import { drizzleExtension, isDrizzleFieldExtension } from '@vantreeseba/drizzle-graphql';
import { accept, deny, resolvePermissions } from '@vantreeseba/graphql-casl';
import { is, Table } from 'drizzle-orm';
import { type GraphQLSchema, isObjectType } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BETTER_AUTH_OPERATIONS } from '../../auth/endpoints.ts';
import { createSchema } from '../../graphql/build-schema.ts';
import { permissionsFor } from '../../graphql/permissions.ts';
import { AUTH_TABLES, SERVER_TABLES, scope } from '../../graphql/tenancy.ts';
import { closeTestDb, createTestDb, type TestDb } from '../helpers.ts';

// Fails when someone adds a table and forgets its access rules, or a write the permission map never meant to allow.
// Nothing else would say so.

/** Tables the schema never exposes. */
const HIDDEN_TABLES = new Set<string>([...AUTH_TABLES, ...SERVER_TABLES]);

/** Every table in the Drizzle schema, by schema key. */
const TABLE_KEYS = Object.entries(dbSchema).flatMap(([key, value]) => (is(value, Table) ? [key] : []));
const exposedTables = TABLE_KEYS.filter((key) => HIDDEN_TABLES.has(key) === false);

/** The generated writes the map serves. Anything else drizzle-graphql generates must arrive refused. */
const SERVED_GENERATED_WRITES = new Set([
  'createTimeBlock',
  'updateTimeBlock',
  'deleteTimeBlock',
  'updateGroup',
  'deleteGroup',
  'updateUser',
]);

describe('tenancy configuration', () => {
  let db: TestDb;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    db = await createTestDb();
    schema = createSchema(db).schema;
  });

  afterAll(() => closeTestDb(db));

  it.each(exposedTables)('scopes %s to the caller', (key) => {
    expect(scope[key]).toBeTypeOf('function');
  });

  it.each([...HIDDEN_TABLES])('leaves %s out of the schema: no type, field or relation reads it', (key) => {
    const objectTypes = Object.values(schema.getTypeMap()).filter(isObjectType);
    const tablesReached = objectTypes.flatMap((type) => [
      drizzleExtension(type)?.table,
      ...Object.values(type.getFields()).map((field) => drizzleExtension(field)?.table),
    ]);
    expect(tablesReached).toContain('groups');
    expect(tablesReached).not.toContain(key);
  });

  it('accepts no nested relation in any generated input', () => {
    const inputs = Object.values(schema.getTypeMap()).filter((type) => /^(Create|Update)\w+Input$/.test(type.name));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const fields = 'getFields' in input ? Object.values(input.getFields()) : [];
      const relationInputs = fields.filter((field) => /Relation|Nested/.test(String(field.type)));
      expect(relationInputs, input.name).toEqual([]);
    }
  });

  it('refuses every generated write the map does not name, so a new table arrives shut', () => {
    const rules = resolvePermissions(schema, permissionsFor(schema));
    const mutation = schema.getMutationType();
    const generated = Object.values(mutation?.getFields() ?? {}).filter((field) =>
      isDrizzleFieldExtension(drizzleExtension(field)),
    );
    const refused = generated.filter((field) => SERVED_GENERATED_WRITES.has(field.name) === false);
    expect(refused.length).toBeGreaterThan(0);
    for (const field of refused) {
      expect(rules('Mutation', field.name), field.name).toBe(deny);
    }
  });

  it("lets every one of better-auth's served operations through", () => {
    const rules = resolvePermissions(schema, permissionsFor(schema));
    const roots = [schema.getQueryType(), schema.getMutationType()].filter(isObjectType);
    const served = roots.flatMap((root) =>
      BETTER_AUTH_OPERATIONS.filter((name) => name in root.getFields()).map((name) => [root.name, name] as const),
    );
    expect(served.map(([, name]) => name).sort()).toEqual([...BETTER_AUTH_OPERATIONS].sort());
    for (const [rootName, name] of [...served, ['Query', 'authConfig'] as const]) {
      expect(rules(rootName, name), name).toBe(accept);
    }
  });
});
