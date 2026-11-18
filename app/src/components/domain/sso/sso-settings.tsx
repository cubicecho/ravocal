import { useMutation, useQuery } from '@apollo/client';
import { useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { PairSsoForm } from '@/components/domain/sso/pair-sso-form';
import { SettingRow } from '@/components/setting-row';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { describeError } from '@/lib/error-message';
import { describePairingError, SSO_SETUP, SsoSource, UNNAMED_PROVIDER, UNPAIR_SSO } from '@/lib/sso';

/** What Settings asks again after a change here: this section, and the providers under Connected accounts. */
const REFETCH = ['SsoSetup', 'Settings'];

/**
 * Settings' "Single sign-on" card, for the admin: the OIDC provider the login page offers, and pairing or
 * disconnecting one. A provider set in the server's environment is shown, but is changed there.
 *
 * @returns The card, or nothing until the setup has loaded.
 */
export function SsoSettings() {
  const { data, error } = useQuery(SSO_SETUP);
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [unpairSso, unpairing] = useMutation(UNPAIR_SSO, {
    refetchQueries: REFETCH,
    awaitRefetchQueries: true,
    // Drawn from `unpairing.error` above the row.
    onError: () => {},
  });
  const setup = data?.ssoSetup;
  if (setup === undefined) {
    return error ? (
      <Alert variant="destructive" title="Couldn't load single sign-on" description={describeError(error)} />
    ) : null;
  }
  const name = setup.name ?? UNNAMED_PROVIDER;
  const problem = unpairing.error ? describePairingError(unpairing.error, `Couldn't disconnect ${name}`) : null;

  return (
    <CardLayout
      title="Single sign-on"
      level={2}
      description="An OpenID Connect provider people can sign in with, offered on the login page to everyone."
      contentSlot={
        <>
          {problem && <Alert variant="destructive" title={problem.title} description={problem.description} />}
          {setup.source === SsoSource.Env && (
            <SettingRow
              title={`Sign in with ${name}`}
              description={
                <>
                  Set by <code className="font-mono text-xs">OIDC_ISSUER</code> in the server's environment, so it is
                  changed there. Its redirect URI is <code className="font-mono text-xs">{setup.redirectUri}</code>.
                </>
              }
              actionSlot={<Badge variant="outline">Environment</Badge>}
            />
          )}
          {setup.source === SsoSource.Paired && (
            <>
              {pairedName !== null && (
                <Alert
                  variant="info"
                  title={`${pairedName} is connected`}
                  description={`Its button is on the login page. Connect it under Connected accounts to sign in with ${pairedName} yourself.`}
                />
              )}
              <SettingRow
                title={`Sign in with ${name}`}
                description={setup.issuer ? `Paired with ${setup.issuer}.` : 'Paired.'}
                actionSlot={
                  <ConfirmButton
                    size="sm"
                    loading={unpairing.loading}
                    loadingLabel="Disconnecting…"
                    title={`Disconnect ${name}?`}
                    description={`Its button leaves the login page, and Ravocal's client is deleted at ${name}. Accounts stay, and can sign in another way.`}
                    confirmLabel="Disconnect"
                    onConfirm={() => {
                      setPairedName(null);
                      void unpairSso();
                    }}
                    content="Disconnect"
                  />
                }
              />
            </>
          )}
          {setup.source === SsoSource.None && (
            <>
              <p className="text-sm text-foreground/60">
                None is set up. Paste the setup URL your provider's admin made for Ravocal, and its button appears on
                the login page.
              </p>
              <PairSsoForm refetchQueries={REFETCH} onPaired={setPairedName} />
            </>
          )}
        </>
      }
    />
  );
}
