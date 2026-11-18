import type { DB } from '@cubicecho/ravocal-db';
import { groupMembers } from '@cubicecho/ravocal-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { badInput, notFound } from '../core/errors.ts';

/** One written row: column values by TS key. */
export type Row = Record<string, unknown>;
/** The transaction a mutation and its hooks run in. */
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];
/** Where a guard reads: the db, or the transaction a write is running in. */
export type Executor = DB | Transaction;

/** The arguments a generated write carries rows in. */
interface WriteArgs {
  /** Rows on create. */
  values?: Row | Row[];
  /** The changed columns on update. */
  set?: Row;
}

/**
 * Collects the rows a write supplies.
 *
 * @param args - Mutation args.
 * @returns One row per written set. A delete supplies none.
 */
export function writtenRows(args: WriteArgs): Row[] {
  if (args.values !== undefined) {
    return [args.values].flat();
  }
  if (args.set !== undefined) {
    return [args.set];
  }
  return [];
}

/**
 * Refuses a write that sets a column the caller may not: an address, a creation time, a key.
 *
 * @remarks
 * The generated inputs offer every column that `contextValues` does not own, and `exclude` can't take a column out of
 * the inputs alone, so each table's hooks name the columns a client may write.
 *
 * @param rows - Written rows.
 * @param writable - The column keys a client may set.
 * @param entity - What the row is called in the refusal.
 * @throws BAD_USER_INPUT naming the first column outside `writable`.
 */
export function assertWritableColumns(rows: Row[], writable: ReadonlySet<string>, entity: string): void {
  const columns = rows.flatMap((row) => Object.keys(row));
  const refused = columns.find((column) => writable.has(column) === false);
  if (refused !== undefined) {
    const allowed = [...writable].join(', ');
    throw badInput(`A ${entity}'s ${refused} can't be set here. Only ${allowed} can.`);
  }
}

/**
 * Checks that the caller is a member of every group the rows name.
 *
 * @param executor - The db, or the write's transaction.
 * @param userId - Caller.
 * @param groupIds - The groups the rows point at. Absent ones (an update that keeps its group) are skipped.
 * @throws NOT_FOUND when any group is missing or the caller isn't in it.
 */
export async function assertMemberOfGroups(executor: Executor, userId: string, groupIds: unknown[]): Promise<void> {
  const named = [...new Set(groupIds.filter((id) => typeof id === 'string'))];
  if (named.length === 0) {
    return;
  }
  const memberships = await executor
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(inArray(groupMembers.groupId, named), eq(groupMembers.userId, userId)));
  const joined = new Set(memberships.map((membership) => membership.groupId));
  const isOutsider = named.some((groupId) => joined.has(groupId) === false);
  if (isOutsider) {
    // NOT_FOUND, not FORBIDDEN: "you may not write here" would confirm the group exists.
    throw notFound('Group not found');
  }
}
