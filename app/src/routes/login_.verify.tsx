import { useMutation } from '@apollo/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { graphql } from '@/__generated__/index.js';
import { PendingScreen } from '@/components/domain/pending-screen';
import { signIn, takeAfterSignIn } from '@/lib/auth';

const searchSchema = z.object({ token: z.string() });

export const Route = createFileRoute('/login_/verify')({
  validateSearch: searchSchema,
  component: VerifyPage,
});

const VERIFY_MAGIC_LINK = graphql(`
  mutation VerifyMagicLink($token: String!) {
    verifyMagicLink(token: $token) {
      token
      user {
        id
        email
        name
      }
    }
  }
`);

function VerifyPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [verifyMagicLink, { error }] = useMutation(VERIFY_MAGIC_LINK, {
    onCompleted: (data) => {
      signIn(data.verifyMagicLink.token);
      void navigate({ href: takeAfterSignIn(), replace: true });
    },
    // The failure is drawn from `error`; handling it here keeps the promise from rejecting.
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
    void verifyMagicLink({ variables: { token } });
  }, [token, verifyMagicLink]);

  return <PendingScreen title="Signing you in…" failedTitle="That sign-in link didn't work" error={error} />;
}
