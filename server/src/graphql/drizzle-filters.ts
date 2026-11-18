import type { LeafAdapter, LeafOperator } from '@vantreeseba/graphql-casl';

// graphql-casl folds an ability's conditions into a filter through an adapter. This one writes drizzle-graphql's
// generated `where` dialect, which since v19 has `AND`, `OR` and `NOT` at every level, so the fold needs no rewriting:
// it is the conditions, spelled the way the schema spells them.

/** A `<Type>Filters` value. */
export type DrizzleFilter = Record<string, unknown>;

/** casl's comparison operators, as drizzle-graphql names them. */
const OPERATORS: Partial<Record<LeafOperator, string>> = {
  $eq: 'eq',
  $ne: 'ne',
  $gt: 'gt',
  $gte: 'gte',
  $lt: 'lt',
  $lte: 'lte',
  $in: 'inArray',
  $nin: 'notInArray',
};

/**
 * Builds the refusal for a condition the adapter can't write. Dropping it instead would widen access.
 *
 * @param what - What could not be written.
 * @returns The error, for the adapter to throw.
 */
const unsupported = (what: string): Error =>
  new Error(`drizzle-graphql filters cannot express ${what}; rewrite the ability rule in permissions.ts.`);

/** The adapter `scopeArgs` writes the caller's conditions with. */
export const drizzleFilters: LeafAdapter<DrizzleFilter> = {
  leaf: ({ path, operator, value }) => {
    const [column] = path;
    const isOwnColumn = path.length === 1 && column !== undefined;
    if (isOwnColumn === false) {
      throw unsupported(`a condition on a related table (\`${path.join('.')}\`)`);
    }
    if (operator === '$exists') {
      return { [column]: value === false ? { isNull: true } : { isNotNull: true } };
    }
    const mapped = OPERATORS[operator];
    if (mapped === undefined) {
      throw unsupported(`the \`${operator}\` operator`);
    }
    return { [column]: { [mapped]: value } };
  },
  and: (filters) => ({ AND: filters }),
  or: (filters) => ({ OR: filters }),
  not: (filter) => ({ NOT: filter }),
  everything: () => ({}),
  // Every table here has an `id` primary key, which is never null.
  nothing: () => ({ id: { isNull: true } }),
};
