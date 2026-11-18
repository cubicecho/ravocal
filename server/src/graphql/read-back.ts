import { resolveSelection, singularizeMapper } from '@vantreeseba/drizzle-graphql';
import type { GraphQLResolveInfo } from 'graphql';
import type { Context } from '../core/context.ts';

/** What a hand-written field reads back, in the generated `where` dialect. */
export interface ReadBack {
  /** The Drizzle schema key of the table its type is generated from. */
  table: string;
  where: Record<string, unknown>;
}

/**
 * Reads the row a hand-written mutation wrote, as the generated query for its type would: the caller's selection,
 * relations and all, through the same `scope`.
 *
 * @param info - The hand-written field's resolve info.
 * @param context - Request context. The scope needs it.
 * @param read - The table and the row.
 * @returns The row, or null when the caller can't read it.
 */
export function readRow(info: GraphQLResolveInfo, context: Context, read: ReadBack): Promise<unknown> {
  return resolveSelection(info, { ...read, db: context.db, context, typeNameMapper: singularizeMapper, single: true });
}

/**
 * Reads the rows a hand-written mutation wrote, as the generated list query for their type would.
 *
 * @param info - The hand-written field's resolve info.
 * @param context - Request context. The scope needs it.
 * @param read - The table and the rows.
 * @returns The rows the caller can read, one default page of them.
 */
export function readRows(info: GraphQLResolveInfo, context: Context, read: ReadBack): Promise<unknown[]> {
  return resolveSelection(info, { ...read, db: context.db, context, typeNameMapper: singularizeMapper });
}
