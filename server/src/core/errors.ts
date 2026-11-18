import { GraphQLError } from 'graphql';

/** The `extensions.code` values clients branch on. */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  NotFound: 'NOT_FOUND',
  BadUserInput: 'BAD_USER_INPUT',
  TooManyRequests: 'TOO_MANY_REQUESTS',
  Forbidden: 'FORBIDDEN',
  Conflict: 'CONFLICT',
  QueryTooComplex: 'QUERY_TOO_COMPLEX',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Makes an error factory for one code.
 *
 * @param code - The `extensions.code` value.
 * @returns A function from message to GraphQLError.
 */
const withCode =
  (code: ErrorCode) =>
  (message: string): GraphQLError =>
    new GraphQLError(message, { extensions: { code } });

/** Arguments the caller can fix. */
export const badInput = withCode(ErrorCode.BadUserInput);
/** Missing, or out of the caller's reach. Deliberately one code, so callers can't probe for ids. */
export const notFound = withCode(ErrorCode.NotFound);
/**
 * This kind of caller may never do this: a mutation off the allow-list, or changing the instance's sign-in without
 * being its admin. Never for a row they can't reach.
 */
export const forbidden = withCode(ErrorCode.Forbidden);
/** The instance is not in a state that allows this, and the caller has to change that first (unpair, then pair). */
export const conflict = withCode(ErrorCode.Conflict);
/** The operation is too deep, too aliased or too costly. Thrown only by operation-limits.ts. */
export const tooComplex = withCode(ErrorCode.QueryTooComplex);

/**
 * Builds the rate-limit refusal.
 *
 * @param message - Client-readable message.
 * @param retryAfter - Seconds until the caller may try again.
 * @returns The error, for the caller to throw.
 */
export const rateLimited = (message: string, retryAfter: number): GraphQLError =>
  new GraphQLError(message, { extensions: { code: ErrorCode.TooManyRequests, retryAfter } });

/**
 * Builds the signed-out refusal. The app drops its session on the code.
 *
 * @param [message] - Client-readable message.
 * @returns The error, for the caller to throw.
 */
export const unauthenticated = (message = 'Not authenticated'): GraphQLError =>
  new GraphQLError(message, { extensions: { code: ErrorCode.Unauthenticated } });

/**
 * Reads the signed-in user's id.
 *
 * @param ctx - Request context.
 * @returns The user's id.
 * @throws UNAUTHENTICATED when nobody is signed in: the id is missing, null or empty.
 */
export function requireAuth(ctx: { userId?: string | null }): string {
  const { userId } = ctx;
  const isSignedOut = userId === undefined || userId === null || userId === '';
  if (isSignedOut) {
    throw unauthenticated();
  }
  return userId;
}

/**
 * Reads what one error says about itself, without its causes.
 *
 * @param error - Anything that was thrown, or a cause.
 * @returns Its message. An AggregateError with none speaks for its errors, and an Error with none gives its code or name.
 */
function ownMessage(error: unknown): string {
  if (error instanceof AggregateError && error.message === '') {
    const inner: unknown[] = error.errors;
    return [...new Set(inner.map(ownMessage))].join(', ');
  }
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return error.message || code || error.name;
  }
  return String(error);
}

/**
 * Reads the message of any caught value, with the chain of causes behind it.
 *
 * @remarks
 * Drizzle wraps a failed connect as "Failed query: select 1", with postgres-js's ECONNREFUSED on `cause`, so the
 * outer message alone hides why.
 *
 * @param error - Whatever was thrown.
 * @returns Each message in the `cause` chain, outermost first, joined with ": ". A value with none is given as a string.
 */
export function errorMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && seen.has(current) === false) {
    seen.add(current);
    const message = ownMessage(current);
    const isNew = message !== '' && messages.includes(message) === false;
    if (isNew) {
      messages.push(message);
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.length === 0 ? String(error) : messages.join(': ');
}
