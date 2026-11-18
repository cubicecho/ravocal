import { useApolloClient, useMutation, useQuery } from '@apollo/client';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { FormError } from '@/components/domain/form/form-error';
import { Alert } from '@/components/ui/alert';
import { HOME_PATH, isSignedIn, storeToken, takeAfterSignIn } from '@/lib/auth';
import { ErrorCode, hasErrorCode } from '@/lib/error-codes';
import { describeError } from '@/lib/error-message';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (isSignedIn()) {
      throw redirect({ to: HOME_PATH });
    }
  },
  component: LoginPage,
});

const AUTH_CONFIG = graphql(`
  query AuthConfig {
    authConfig {
      secureLocalNet
      magicLink
    }
  }
`);

const SIGN_IN_MAGIC_LINK = graphql(`
  mutation SignInMagicLink($email: String!) {
    signInMagicLink(email: $email) {
      status
      token
    }
  }
`);

/**
 * What a failed request for a link says: the throttle's refusal as a callout of its own, since the reader has to
 * wait rather than fix anything, and every other failure under the field.
 *
 * @param props - The request's failure.
 * @returns The message, or nothing while there is none.
 */
function SignInError({ error }: { error: unknown }) {
  if (hasErrorCode(error, ErrorCode.TooManyRequests)) {
    return <Alert variant="warning" title="Too many sign-in attempts" description={describeError(error)} />;
  }
  return <FormError error={error} />;
}

function LoginPage() {
  // The address the link went to, once it has been sent.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const config = useQuery(AUTH_CONFIG).data?.authConfig;
  const navigate = useNavigate();
  const client = useApolloClient();
  // Under SECURE_LOCAL_NET the address alone signs in, and no link is sent.
  const isLocalNet = config?.secureLocalNet === true;
  const [signInMagicLink, { error }] = useMutation(SIGN_IN_MAGIC_LINK, {
    // The failure is drawn from `error` under the field; handling it here keeps the submit's
    // promise from rejecting unhandled.
    onError: () => {},
  });

  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      const res = await signInMagicLink({ variables: { email } });
      const result = res.data?.signInMagicLink;
      if (result?.token) {
        storeToken(result.token);
        await client.clearStore();
        await navigate({ href: takeAfterSignIn(), replace: true });
        return;
      }
      if (result?.status) {
        setSentTo(email);
      }
    },
  });

  if (sentTo) {
    return (
      <CenteredCardLayout
        title="Check your email"
        description={`We sent a sign-in link to ${sentTo}. Open it to finish signing in. It works once.`}
      />
    );
  }

  // Only once the server has answered: a page still loading is not a broken instance.
  const cannotSignIn = config !== undefined && config.magicLink === false && isLocalNet === false;
  if (cannotSignIn) {
    return (
      <CenteredCardLayout
        title="Sign in to Ravocal"
        contentSlot={
          <Alert
            variant="destructive"
            title="Sign-in is not set up"
            description="This instance cannot email sign-in links. Whoever runs it needs to set SMTP_URL, or SECURE_LOCAL_NET=true on a private network."
          />
        }
      />
    );
  }

  return (
    <CenteredCardLayout
      title="Sign in to Ravocal"
      description={
        isLocalNet
          ? 'Enter your email to sign in. There is no password.'
          : "We'll email you a link that signs you in. There's no password."
      }
      wrapperSlot={(parts, { className }) => (
        <form
          className={className}
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {parts}
        </form>
      )}
      contentSlot={
        <div className="grid gap-4">
          <InputField
            form={form}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            validators={{
              onChange: ({ value }) => (value.trim() === '' ? 'Enter your email.' : undefined),
            }}
          />
          <SignInError error={error} />
        </div>
      }
      footerActionsSlot={
        <form.AppForm>
          <form.SubmitButton
            createLabel={isLocalNet ? 'Sign in' : 'Send sign-in link'}
            loadingLabel={isLocalNet ? 'Signing in…' : 'Sending…'}
          />
        </form.AppForm>
      }
    />
  );
}
