import { GraphQLError } from 'graphql';
import type { YogaLogger } from 'graphql-yoga';

/**
 * Finds what an error was before GraphQL wrapped it. The permission layer resolves a field through its own wrapper, so
 * a resolver's error can arrive wrapped twice.
 *
 * @param error - A GraphQL error with an original error.
 * @returns The innermost original error.
 */
const rootCause = (error: GraphQLError): unknown => {
  let cause: unknown = error.originalError;
  while (cause instanceof GraphQLError && cause.originalError !== undefined) {
    cause = cause.originalError;
  }
  return cause;
};

/**
 * Picks what to print for one logged value. A masked error prints its path and its cause, which carries the real stack.
 *
 * @param value - What Yoga logged.
 * @returns The values to print.
 */
const describe = (value: unknown): unknown[] => {
  const isMasked = value instanceof GraphQLError && value.originalError !== undefined;
  if (isMasked) {
    const path = value.path?.join('.') ?? '';
    return [path, rootCause(value)];
  }
  return [value];
};

/** Yoga's logger with the `[graphql]` tag. Operation variables are never logged. */
export const graphqlLogger: YogaLogger = {
  // Yoga narrates every request at debug level.
  debug: () => {},
  info: (...args) => console.info('[graphql]', ...args),
  warn: (...args) => console.warn('[graphql]', ...args),
  error: (...args) => console.error('[graphql]', ...args.flatMap(describe)),
};
