import type { DB } from '@cubicecho/ravocal-db';
import { type ProviderConfig, ProviderId, providerConfigs } from '../core/config.ts';
import { effectiveOidc } from '../sso/settings.ts';
import { type Auth, type AuthOptions, createAuth } from './better-auth.ts';

// better-auth fixes its plugins when it is created, and the providers are one of them. Pairing or unpairing the OIDC
// provider while the server runs therefore means a new instance, so everything that signs people in asks this host
// for the current one on each request instead of holding on to one from boot. Sessions are rows in Postgres, so a
// rebuild signs nobody out.

/**
 * Reads every provider sign-in offers now: Google and Facebook from the environment, then the OIDC provider from the
 * environment or the pairing.
 *
 * @param db - The database the pairing is kept in.
 * @returns The providers, in the order the login page lists them.
 */
export async function currentProviders(db: DB): Promise<ProviderConfig[]> {
  const { config } = await effectiveOidc(db);
  const oidc: ProviderConfig[] = config === null ? [] : [{ id: ProviderId.Oidc, ...config }];
  return [...providerConfigs(), ...oidc];
}

/** Where the current auth instance is. */
export interface AuthHost {
  /** The auth instance to use for this request. */
  current(): Auth;
  /** The providers `current()` was built with: the ones sign-in offers. */
  providers(): readonly ProviderConfig[];
  /** Builds a new instance from the providers set now, the pairing among them. */
  rebuild(): Promise<void>;
}

/**
 * Builds a host from the providers in the environment and the pairing.
 *
 * @param db - The database every instance keeps users and sessions in. Migrations must have run: the pairing is read
 *   from it.
 * @param [opts] - Passed to every `createAuth`, for tests. `providers` is the host's to decide.
 * @returns The host, with its first instance built.
 */
export async function createAuthHost(db: DB, opts: Omit<AuthOptions, 'providers'> = {}): Promise<AuthHost> {
  const build = async () => {
    const providers = await currentProviders(db);
    return { auth: createAuth(db, { ...opts, providers }), providers };
  };
  let built = await build();
  return {
    current: () => built.auth,
    providers: () => built.providers,
    async rebuild() {
      built = await build();
    },
  };
}

/**
 * Builds a host that never changes, for a caller that already has its instance.
 *
 * @param auth - The instance.
 * @param [providers] - The providers it was built with.
 * @returns The host. Its `rebuild` does nothing.
 */
export function fixedAuthHost(auth: Auth, providers: readonly ProviderConfig[] = []): AuthHost {
  return { current: () => auth, providers: () => providers, rebuild: async () => {} };
}
