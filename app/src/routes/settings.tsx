import { useMutation, useQuery } from '@apollo/client';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import type { SettingsQuery } from '@/__generated__/graphql.js';
import { graphql } from '@/__generated__/index.js';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { SettingRow } from '@/components/setting-row';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';
import { asQuery } from '@/lib/as-query';
import { describeError } from '@/lib/error-message';
import { describeProviderError } from '@/lib/provider-errors';

/** How a link started here comes back: the provider it connected, or better-auth's code and which provider failed. */
const searchSchema = z.object({
  connected: z.string().optional(),
  error: z.string().optional(),
  provider: z.string().optional(),
});

export const Route = createFileRoute('/settings')({
  validateSearch: searchSchema,
  component: SettingsPage,
});

const SETTINGS = graphql(`
  query Settings {
    authConfig {
      secureLocalNet
      magicLink
      providers {
        id
        name
      }
    }
    getSession {
      user {
        email
        emailVerified
      }
    }
    listUserAccounts {
      id
      providerId
    }
  }
`);

const LINK_SOCIAL_ACCOUNT = graphql(`
  mutation LinkSocialAccount($provider: String!) {
    linkSocialAccount(provider: $provider) {
      url
    }
  }
`);

const UNLINK_ACCOUNT = graphql(`
  mutation UnlinkAccount($accountId: String!) {
    unlinkAccount(accountId: $accountId) {
      status
    }
  }
`);

type Settings = SettingsQuery;
type Provider = Settings['authConfig']['providers'][number];

/**
 * Whether the reader could sign in by email: anyone can under SECURE_LOCAL_NET, and otherwise a confirmed address
 * can while the instance sends links. The server keeps the same rule (unlinkAccount).
 *
 * @param settings - What the page read.
 * @returns true when the email way in works for this reader.
 */
function emailSignsIn(settings: Settings): boolean {
  const { secureLocalNet, magicLink } = settings.authConfig;
  return secureLocalNet || (magicLink && settings.getSession?.user.emailVerified === true);
}

/**
 * The email row: whether a link (or, on a private network, the address alone) signs the reader in.
 *
 * @param props - What the page read.
 * @returns The row.
 */
function EmailRow({ settings }: { settings: Settings }) {
  const email = settings.getSession?.user.email ?? 'your address';
  const { secureLocalNet, magicLink } = settings.authConfig;
  if (secureLocalNet) {
    return (
      <SettingRow
        title="Email"
        description={`Typing ${email} signs you in on this network.`}
        actionSlot={<Badge variant="positive-soft">On</Badge>}
      />
    );
  }
  if (magicLink === false) {
    return (
      <SettingRow
        title="Email link"
        description="This instance doesn't email sign-in links."
        actionSlot={<Badge variant="outline">Off</Badge>}
      />
    );
  }
  return emailSignsIn(settings) ? (
    <SettingRow
      title="Email link"
      description={`A link sent to ${email} signs you in.`}
      actionSlot={<Badge variant="positive-soft">On</Badge>}
    />
  ) : (
    <SettingRow
      title="Email link"
      description={`A link sent to ${email} would sign you in, once one has confirmed the address is yours.`}
      actionSlot={<Badge variant="warning-soft">Not confirmed</Badge>}
    />
  );
}

/** What one provider's row needs from the page. */
interface ProviderRowProps {
  provider: Provider;
  /** The connected account's id, or undefined when this provider is not connected. */
  accountId: string | undefined;
  /** Whether disconnecting it would leave the reader no way to sign in. */
  isLastWay: boolean;
  /** Whether a connect or a disconnect is running, for any provider. */
  busy: boolean;
  /** Whether this provider's connect is the one running. */
  connecting: boolean;
  onConnect: (provider: Provider) => void;
  onDisconnect: (accountId: string) => void;
}

/**
 * One provider: connected or not, and the button that changes it.
 *
 * @param props - The provider, its account, and what the buttons do.
 * @returns The row.
 */
function ProviderRow({ provider, accountId, isLastWay, busy, connecting, onConnect, onDisconnect }: ProviderRowProps) {
  if (accountId === undefined) {
    return (
      <SettingRow
        title={provider.name}
        description={`Not connected. Connect it to sign in with ${provider.name}.`}
        actionSlot={
          <Button
            variant="info-outline"
            size="sm"
            disabled={busy}
            loading={connecting}
            loadingLabel="Connecting…"
            onClick={() => onConnect(provider)}
            content="Connect"
          />
        }
      />
    );
  }
  return (
    <SettingRow
      title={provider.name}
      description={`Connected. You can sign in with ${provider.name}.`}
      actionSlot={
        <ConfirmButton
          size="sm"
          disabled={busy || isLastWay}
          hint={
            isLastWay ? 'This is your only way to sign in. Confirm your email with a sign-in link first.' : undefined
          }
          title={`Disconnect ${provider.name}?`}
          description={`You won't be able to sign in with ${provider.name} until you connect it again.`}
          confirmLabel="Disconnect"
          onConfirm={() => onDisconnect(accountId)}
          content="Disconnect"
        />
      }
    />
  );
}

/**
 * What came back from a provider, or from the last change: a connection made, or why one failed.
 *
 * @param props - The page's search, the providers, and the last mutation's failure.
 * @returns The callout, or nothing.
 */
function Outcome({
  search,
  providers,
  failure,
}: {
  search: z.infer<typeof searchSchema>;
  providers: readonly Provider[];
  failure: unknown;
}) {
  const nameOf = (id: string | undefined) => providers.find((provider) => provider.id === id)?.name;
  if (failure) {
    return <Alert variant="destructive" title="That didn't work" description={describeError(failure)} />;
  }
  if (search.error !== undefined) {
    const description = describeProviderError(search.error, nameOf(search.provider));
    return <Alert variant="destructive" title="Couldn't connect that account" description={description} />;
  }
  const connected = nameOf(search.connected);
  if (connected !== undefined) {
    return (
      <Alert variant="info" title={`${connected} is connected`} description={`You can sign in with ${connected}.`} />
    );
  }
  return null;
}

function SettingsPage() {
  const search = Route.useSearch();
  const result = useQuery(SETTINGS);
  // The provider whose Connect was pressed last.
  const [pending, setPending] = useState<string | null>(null);
  const settings = result.data;
  const [linkSocialAccount, linking] = useMutation(LINK_SOCIAL_ACCOUNT, {
    // Leaves the page for the provider, which sends the reader back here.
    onCompleted: (data) => window.location.assign(data.linkSocialAccount.url),
    // Drawn from `linking.error` above the rows.
    onError: () => {},
  });
  const [unlinkAccount, unlinking] = useMutation(UNLINK_ACCOUNT, {
    refetchQueries: [SETTINGS],
    awaitRefetchQueries: true,
    onError: () => {},
  });

  const providers = settings?.authConfig.providers ?? [];
  const accounts = settings?.listUserAccounts ?? [];
  const accountOf = (provider: Provider) => accounts.find((account) => account.providerId === provider.id)?.id;
  const connectedCount = providers.filter((provider) => accountOf(provider) !== undefined).length;
  // Disconnecting the only provider connected leaves the email way in, if it works.
  const isLastWay = settings !== undefined && connectedCount === 1 && emailSignsIn(settings) === false;
  // Once the link has its URL the page is on its way to the provider.
  const isLeaving = linking.data !== undefined;
  const busy = linking.loading || isLeaving || unlinking.loading;

  return (
    <PageLayout
      title="Settings"
      width="prose"
      backSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Back to your groups"
          iconSlot={<ArrowLeft />}
          linkSlot={<Link to="/groups" />}
        />
      }
      contentSlot={
        <>
          <Outcome search={search} providers={providers} failure={linking.error ?? unlinking.error} />
          <LoadState
            query={asQuery(result)}
            what="your settings"
            record={settings}
            notFoundLabel="Your settings aren't available"
            level={2}
          />
          {settings && (
            <CardLayout
              title="Connected accounts"
              level={2}
              description="The ways you can sign in to Ravocal. Keep at least one."
              contentSlot={
                <>
                  <EmailRow settings={settings} />
                  {providers.map((provider) => (
                    <ProviderRow
                      key={provider.id}
                      provider={provider}
                      accountId={accountOf(provider)}
                      isLastWay={isLastWay}
                      busy={busy}
                      connecting={(linking.loading || isLeaving) && pending === provider.id}
                      onConnect={(chosen) => {
                        setPending(chosen.id);
                        void linkSocialAccount({ variables: { provider: chosen.id } });
                      }}
                      onDisconnect={(accountId) => void unlinkAccount({ variables: { accountId } })}
                    />
                  ))}
                </>
              }
            />
          )}
        </>
      }
    />
  );
}
