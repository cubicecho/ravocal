import { useApolloClient, useMutation } from '@apollo/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { graphql } from '@/__generated__/index.js';
import { PendingScreen } from '@/components/domain/pending-screen';
import { storeToken, takeAfterSignIn } from '@/lib/auth';

const searchSchema = z.object({ token: z.string() });

// Public (lib/auth.ts, PUBLIC_PATHS): the link from the email lands here, signed in or not.
export const Route = createFileRoute('/auth/verify')({
  validateSearch: searchSchema,
  component: VerifyPage,
});

const MAGIC_LINK_VERIFY = graphql(`
  mutation MagicLinkVerify($token: String!) {
    magicLinkVerify(token: $token) {
      token
    }
  }
`);

function VerifyPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const client = useApolloClient();
  const [magicLinkVerify, { error }] = useMutation(MAGIC_LINK_VERIFY, {
    onCompleted: async (data) => {
      storeToken(data.magicLinkVerify.token);
      // The link may sign in someone other than whoever was signed in before.
      await client.clearStore();
      await navigate({ href: takeAfterSignIn(), replace: true });
    },
    // The failure is drawn from `error`; handling it here keeps the promise from rejecting. A spent or unknown
    // link is BAD_USER_INPUT, so whoever was already signed in stays signed in.
    onError: () => {},
  });

  // A magic link works once, and StrictMode runs an effect twice: the second run would spend the
  // link again and fail. The ref lives through StrictMode's remount, so the link is sent once.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === token) {
      return;
    }
    sent.current = token;
    void magicLinkVerify({ variables: { token } });
  }, [token, magicLinkVerify]);

  return <PendingScreen title="Signing you in…" failedTitle="That sign-in link didn't work" error={error} />;
}
