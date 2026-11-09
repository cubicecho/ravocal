/** What Apollo's `useQuery` hands back, as far as `LoadState` needs it. */
interface ApolloQueryState {
  loading: boolean;
  error?: unknown;
  refetch: () => unknown;
}

/**
 * Apollo's `{ loading, error, refetch }` in the `{ isPending, isError, error, refetch }` shape
 * `LoadState` reads, so a page passes `query={asQuery(result)}` rather than spelling it out.
 */
export function asQuery(result: ApolloQueryState) {
  return {
    isPending: result.loading,
    isError: result.error !== undefined,
    error: result.error ?? null,
    refetch: result.refetch,
  };
}
