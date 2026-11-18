import { useMutation } from '@apollo/client';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { FormError } from '@/components/domain/form/form-error';
import { HOME_PATH, isSignedIn } from '@/lib/auth';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (isSignedIn()) throw redirect({ to: HOME_PATH });
  },
  component: LoginPage,
});

const REQUEST_MAGIC_LINK = graphql(`
  mutation RequestMagicLink($email: String!) {
    requestMagicLink(email: $email)
  }
`);

function LoginPage() {
  // The address the link went to, once it has been sent.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [requestMagicLink, { error }] = useMutation(REQUEST_MAGIC_LINK, {
    // The failure is drawn from `error` under the field; handling it here keeps the submit's
    // promise from rejecting unhandled.
    onError: () => {},
  });

  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      const res = await requestMagicLink({ variables: { email } });
      if (res.data?.requestMagicLink) setSentTo(email);
    },
  });

  if (sentTo) {
    return (
      <CenteredCardLayout
        title="Check your email"
        description={`We sent a sign-in link to ${sentTo}. Open it in this browser to finish signing in.`}
      />
    );
  }

  return (
    <CenteredCardLayout
      title="Sign in to Ravocal"
      description="We'll email you a link that signs you in. There's no password."
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
          <FormError error={error} />
        </div>
      }
      footerActionsSlot={
        <form.AppForm>
          <form.SubmitButton createLabel="Send sign-in link" loadingLabel="Sending…" />
        </form.AppForm>
      }
    />
  );
}
