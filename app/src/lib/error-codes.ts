/** The server's `extensions.code` values the app branches on (server/src/core/errors.ts). */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  BadUserInput: 'BAD_USER_INPUT',
  TooManyRequests: 'TOO_MANY_REQUESTS',
  Forbidden: 'FORBIDDEN',
  Conflict: 'CONFLICT',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** What `hasErrorCode` and `errorReason` read off an Apollo error, without importing the class. */
interface CodedErrors {
  graphQLErrors?: ReadonlyArray<{ extensions?: { code?: unknown; reason?: unknown } | undefined }> | undefined;
}

/**
 * Whether a failed request was refused with a code.
 *
 * @param error - What a query or mutation failed with.
 * @param code - The code to look for.
 * @returns true when any of its GraphQL errors carries the code.
 */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { graphQLErrors }: CodedErrors = error;
  return graphQLErrors?.some((entry) => entry.extensions?.code === code) === true;
}

/**
 * Reads why a failed request was refused, where the server says more than its code (pairing's `extensions.reason`).
 *
 * @param error - What a query or mutation failed with.
 * @returns The first GraphQL error's reason, or undefined when it gives none.
 */
export function errorReason(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { graphQLErrors }: CodedErrors = error;
  const reason = graphQLErrors?.find((entry) => entry.extensions?.reason !== undefined)?.extensions?.reason;
  return typeof reason === 'string' ? reason : undefined;
}
