import type { OnWriteConfig, WriteHookPayload } from '@vantreeseba/drizzle-graphql';
import { parseOrThrow } from '../core/validation.ts';
import { assertWritableColumns, writtenRows } from '../graphql/write-guards.ts';
import { userInput } from './input.ts';

/** What a user may change about themselves. Their address and its proof are better-auth's, set by signing in. */
const WRITABLE = new Set(['name']);

/** Checks on `users`' generated update. Users are created by signing in, never through the schema. */
export const userWriteHooks: OnWriteConfig = {
  users: {
    update: {
      /**
       * Refuses every column but the name, and a name out of range.
       *
       * @param payload - The write about to run.
       */
      before: ({ args }: WriteHookPayload) => {
        const rows = writtenRows(args);
        assertWritableColumns(rows, WRITABLE, 'user');
        for (const row of rows) {
          parseOrThrow(userInput, row);
        }
      },
    },
  },
};
