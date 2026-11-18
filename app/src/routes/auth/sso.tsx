import { useApolloClient, useMutation } from '@apollo/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { graphql } from '@/__generated__/index.js';
import { PendingScreen } from '@/components/domain/pending-screen';
import { storeToken, takeAfterSignIn } from '@/lib/auth';

const searchSchema = z.object({ token: z.string().optional() });

// Public (lib/auth.ts, PUBLIC_PATHS): the server's callback for Google, Facebook or the OIDC provider lands here, with a
// one-time token for the session it opened.
export const Route = createFileRoute('/auth/sso')({
  validateSearch: searchSchema,
  component: SsoPage,
});

const VERIFY_ONE_TIME_TOKEN = graphql(`
  mutation VerifyOneTimeToken($token: String!) {
    verifyOneTimeToken(token: $token) {
      token
    }
  }
`);

/** What the page says after the failure's own message. */
const FINISH_IN_TIME = 'A sign-in has to be finished within a few minutes, and only once.';

/** Said when the callback's redirect arrived without its token. */
const NO_TOKEN = new Error('The sign-in came back without its token.');

function SsoPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const client = useApolloClient();
  const [verifyOneTimeToken, { error }] = useMutation(VERIFY_ONE_TIME_TOKEN, {
    onCompleted: async (data) => {
      storeToken(data.verifyOneTimeToken.token);
      // The provider may sign in someone other than whoever was signed in before.
      await client.clearStore();
      await navigate({ href: takeAfterSignIn(), replace: true });
    },
    // The failure is drawn from `error`; handling it here keeps the promise from rejecting. A spent or expired token
    // is BAD_USER_INPUT, so whoever was already signed in stays signed in.
    onError: () => {},
  });

  // The token is spent on first use, and StrictMode runs an effect twice: the ref lives through its remount, so the
  // token is sent once.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (token === undefined || sent.current === token) {
      return;
    }
    sent.current = token;
    void verifyOneTimeToken({ variables: { token } });
  }, [token, verifyOneTimeToken]);

  return (
    <PendingScreen
      title="Signing you in…"
      failedTitle="That sign-in didn't work"
      error={token === undefined ? NO_TOKEN : error}
      failedHint={FINISH_IN_TIME}
    />
  );
}
