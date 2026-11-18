import type { OnWriteConfig, WriteHookPayload } from '@vantreeseba/drizzle-graphql';
import { requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { assertMemberOfGroups, assertWritableColumns, writtenRows } from '../graphql/write-guards.ts';
import { timeWindowSchema } from './input.ts';

/** What a client may set on a block. Whose it is comes from the request (tenancy.ts). */
const WRITABLE = new Set(['groupId', 'startsAt', 'endsAt']);

/** The columns the checks read, whatever the client selected. */
const CHECKED = ['groupId', 'startsAt', 'endsAt'];

/**
 * Refuses a column a client may not set, before anything is written.
 *
 * @param payload - The write about to run.
 */
function refuseServerColumns({ args }: WriteHookPayload): void {
  assertWritableColumns(writtenRows(args), WRITABLE, 'time block');
}

/**
 * Checks each block as it was written: in a group the caller is in, on the grid, ending after it starts.
 *
 * @remarks
 * After the statement, so an update's checks see the whole row and not only the columns it changed. A throw rolls
 * the write back.
 *
 * @param payload - The write that just ran.
 * @throws NOT_FOUND for a group the caller isn't in, including a block moved into one; BAD_USER_INPUT for a window.
 */
async function checkWrittenBlocks({ rows, context, tx }: WriteHookPayload): Promise<void> {
  await assertMemberOfGroups(
    tx,
    requireAuth(context),
    rows.map((row) => row.groupId),
  );
  for (const row of rows) {
    parseOrThrow(timeWindowSchema, row);
  }
}

/** Checks on `time_blocks`' generated create and update. A delete needs none: casl limits it to your own. */
export const timeBlockWriteHooks: OnWriteConfig = {
  timeBlocks: {
    insert: { before: refuseServerColumns, after: checkWrittenBlocks, columns: CHECKED },
    update: { before: refuseServerColumns, after: checkWrittenBlocks, columns: CHECKED },
  },
};
