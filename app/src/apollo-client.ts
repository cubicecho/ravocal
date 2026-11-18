import { ApolloClient, createHttpLink, from, InMemoryCache } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { clearToken, getToken, LOGIN_PATH, PUBLIC_PATHS, rememberAfterSignIn } from '@/lib/auth';
import { ErrorCode } from '@/lib/error-codes';

const httpLink = createHttpLink({ uri: '/graphql' });

const authLink = setContext((_, { headers }) => {
  const token = getToken();
  return {
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  };
});

// UNAUTHENTICATED means the session is gone (expired, signed out elsewhere, or a token from before sessions were
// kept on the server), not that this one request was refused. So the token is dropped and the reader signs in again,
// coming back to this page. A bad sign-in link is BAD_USER_INPUT, so it never lands here.
const errorLink = onError(({ graphQLErrors }) => {
  const isSignedOut = graphQLErrors?.some((error) => error.extensions?.code === ErrorCode.Unauthenticated) === true;
  if (isSignedOut === false) {
    return;
  }
  clearToken();
  const { pathname, search } = window.location;
  if (PUBLIC_PATHS.has(pathname)) {
    return;
  }
  rememberAfterSignIn(`${pathname}${search}`);
  // A full load, so nothing the old session fetched survives in the cache.
  window.location.replace(LOGIN_PATH);
});

export const apolloClient = new ApolloClient({
  link: from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache(),
});
