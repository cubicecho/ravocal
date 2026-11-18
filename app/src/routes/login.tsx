import { useApolloClient, useMutation, useQuery } from '@apollo/client';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import type { AuthConfigQuery } from '@/__generated__/graphql.js';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { FormError } from '@/components/domain/form/form-error';
import { PairSsoForm } from '@/components/domain/sso/pair-sso-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { HOME_PATH, isSignedIn, storeToken, takeAfterSignIn } from '@/lib/auth';
import { ErrorCode, hasErrorCode } from '@/lib/error-codes';
import { describeError } from '@/lib/error-message';
import { describeProviderError } from '@/lib/provider-errors';
import { SSO_SETUP, SsoSource } from '@/lib/sso';

/** What a provider's sign-in comes back with when it failed: better-auth's code, and which provider it was. */
const searchSchema = z.object({ error: z.string().optional(), provider: z.string().optional() });

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
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
      providers {
        id
        name
        signInUrl
      }
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

type Provider = AuthConfigQuery['authConfig']['providers'][number];

/** What setting sign-in up changes on this page, asked again by name. */
const SETUP_REFETCH = ['SsoSetup', 'AuthConfig'];

/**
 * The page a new instance's first visitor sets sign-in up on: paste the setup URL a provider made for Ravocal, and
 * its button appears on the sign-in page.
 *
 * @param props - What to do once paired, and how to go back.
 * @returns The page.
 */
function SetUpSignIn({ onPaired, onBack }: { onPaired: (name: string) => void; onBack: () => void }) {
  return (
    <CenteredCardLayout
      title="Set up sign-in"
      cardClassName="max-w-md"
      description="Nobody has an account here yet. Paste the setup URL your sign-in provider made for Ravocal, and its button appears on the sign-in page. The first account to sign in becomes this instance's admin."
      contentSlot={
        <PairSsoForm
          refetchQueries={SETUP_REFETCH}
          onPaired={onPaired}
          secondaryActionSlot={<Button variant="outline" onClick={onBack} content="Back" />}
        />
      }
    />
  );
}

/**
 * Offers a new instance's first visitor to set sign-in up with a provider.
 *
 * @param props - What the button does.
 * @returns The callout.
 */
function SetUpOffer({ onSetUp }: { onSetUp: () => void }) {
  return (
    <Alert
      variant="info"
      title="New instance"
      description="Nobody has an account yet. Set sign-in up with a provider by pasting the setup URL it gave you."
      actionSlot={<Button variant="outline" size="sm" onClick={onSetUp} content="Set up sign-in" />}
    />
  );
}

/**
 * What a failed request for a link says: the throttle's refusal as a callout of its own, since the reader has to
 * wait rather than fix anything, and every other failure under the field.
 *
 * @param props - The request's failure.
 * @returns The message, or nothing while there is none.
 */
function SignInError({ error }: { error: unknown }) {
  if (hasErrorCode(error, ErrorCode.TooManyRequests)) {
    return <Alert variant="warning" title="Wait before trying again" description={describeError(error)} />;
  }
  return <FormError error={error} />;
}

/**
 * The buttons that sign in with a provider. Each is a link to the server's start route: a full page load, out to the
 * provider and back, not a request the app makes.
 *
 * @param props - The providers this instance offers.
 * @returns The buttons, one under the other.
 */
function ProviderButtons({ providers }: { providers: readonly Provider[] }) {
  return (
    <div className="grid gap-2">
      {providers.map((provider) => (
        <Button
          key={provider.id}
          variant="outline"
          className="w-full"
          linkSlot={<a href={provider.signInUrl} />}
          content={`Continue with ${provider.name}`}
        />
      ))}
    </div>
  );
}

/**
 * The line under the title: which ways in this page offers.
 *
 * @param isLocalNet - Whether the address alone signs in.
 * @param hasEmail - Whether the address can be used at all.
 * @param providers - The providers on offer.
 * @returns The sentence.
 */
function describeWaysIn(isLocalNet: boolean, hasEmail: boolean, providers: readonly Provider[]): string {
  const names = providers.map((provider) => provider.name).join(' or ');
  if (isLocalNet) {
    return 'Enter your email to sign in. There is no password.';
  }
  if (hasEmail && providers.length > 0) {
    return `Continue with ${names}, or we'll email you a link that signs you in. There's no password.`;
  }
  if (hasEmail) {
    return "We'll email you a link that signs you in. There's no password.";
  }
  return `Sign in with your ${names} account. There's no password.`;
}

function LoginPage() {
  // The address the link went to, once it has been sent.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const search = Route.useSearch();
  const config = useQuery(AUTH_CONFIG).data?.authConfig;
  const navigate = useNavigate();
  const client = useApolloClient();
  // Under SECURE_LOCAL_NET the address alone signs in, and no link is sent.
  const isLocalNet = config?.secureLocalNet === true;
  // While the server has not answered, the email form shows, as it does on most instances.
  const hasEmail = config === undefined || isLocalNet || config.magicLink;
  const providers = config?.providers ?? [];
  // A brand-new instance with nothing paired: whoever opens it first may pair a provider (server/src/sso).
  const setup = useQuery(SSO_SETUP).data?.ssoSetup;
  const canSetUp = setup?.canPair === true && setup.source === SsoSource.None;
  const [settingUp, setSettingUp] = useState(false);
  // The provider just paired here, whose button is now on the page.
  const [pairedName, setPairedName] = useState<string | null>(null);
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

  if (settingUp && canSetUp) {
    return (
      <SetUpSignIn
        onBack={() => setSettingUp(false)}
        onPaired={(name) => {
          setPairedName(name);
          setSettingUp(false);
        }}
      />
    );
  }

  // Only once the server has answered: a page still loading is not a broken instance.
  const cannotSignIn = config !== undefined && hasEmail === false && providers.length === 0;
  if (cannotSignIn) {
    return (
      <CenteredCardLayout
        title="Sign in to Ravocal"
        contentSlot={
          <div className="grid gap-4">
            <Alert
              variant={canSetUp ? 'warning' : 'destructive'}
              title="Sign-in is not set up"
              description="This instance cannot email sign-in links and offers no provider to sign in with. Whoever runs it needs to set SMTP_URL, a Google or Facebook client, an OIDC provider, or SECURE_LOCAL_NET=true on a private network."
            />
            {canSetUp && <SetUpOffer onSetUp={() => setSettingUp(true)} />}
          </div>
        }
      />
    );
  }

  const paired =
    pairedName === null ? null : (
      <Alert
        variant="info"
        title={`${pairedName} is set up`}
        description={`Continue with ${pairedName} to make the first account. It becomes this instance's admin.`}
      />
    );

  const providerName = providers.find((provider) => provider.id === search.provider)?.name;
  const failure =
    search.error === undefined ? null : (
      <Alert
        variant="destructive"
        title="That sign-in didn't work"
        description={describeProviderError(search.error, providerName)}
      />
    );

  return (
    <CenteredCardLayout
      title="Sign in to Ravocal"
      description={describeWaysIn(isLocalNet, hasEmail, providers)}
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
          {failure}
          {paired}
          {providers.length > 0 && <ProviderButtons providers={providers} />}
          {providers.length > 0 && hasEmail && <Separator />}
          {hasEmail && (
            <>
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
            </>
          )}
          {canSetUp && <SetUpOffer onSetUp={() => setSettingUp(true)} />}
        </div>
      }
      footerActionsSlot={
        hasEmail ? (
          <form.AppForm>
            <form.SubmitButton
              createLabel={isLocalNet ? 'Sign in' : 'Send sign-in link'}
              loadingLabel={isLocalNet ? 'Signing in…' : 'Sending…'}
            />
          </form.AppForm>
        ) : undefined
      }
    />
  );
}
