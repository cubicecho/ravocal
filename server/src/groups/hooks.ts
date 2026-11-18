import type { OnWriteConfig, WriteHookPayload } from '@vantreeseba/drizzle-graphql';
import { parseOrThrow } from '../core/validation.ts';
import { assertWritableColumns, writtenRows } from '../graphql/write-guards.ts';
import { groupInput } from './input.ts';

/** What `updateGroup` may change. Who owns it is never one of them (tenancy.ts takes `ownerId` out of the input). */
const WRITABLE = new Set(['name', 'overlapThreshold']);

/** Checks on `groups`' generated update. Creating one is hand-written (resolvers.ts). */
export const groupWriteHooks: OnWriteConfig = {
  groups: {
    update: {
      /**
       * Refuses a column a client may not set, and a name or threshold out of range.
       *
       * @param payload - The write about to run.
       */
      before: ({ args }: WriteHookPayload) => {
        const rows = writtenRows(args);
        assertWritableColumns(rows, WRITABLE, 'group');
        for (const row of rows) {
          parseOrThrow(groupInput, row);
        }
      },
    },
  },
};
