/**
 * Pairing the instance with an OIDC provider from a setup URL (server/src/sso): the documents the login page and
 * Settings share, and what each refusal tells the reader.
 */
import { graphql } from '@/__generated__/index.js';
import { errorReason } from '@/lib/error-codes';
import { describeError } from '@/lib/error-message';

export const SSO_SETUP = graphql(`
  query SsoSetup {
    ssoSetup {
      source
      issuer
      name
      canPair
      redirectUri
    }
  }
`);

export const PAIR_SSO = graphql(`
  mutation PairSso($setupUrl: String!) {
    pairSso(setupUrl: $setupUrl) {
      source
      issuer
      name
      canPair
      redirectUri
    }
  }
`);

export const UNPAIR_SSO = graphql(`
  mutation UnpairSso {
    unpairSso {
      source
      issuer
      name
      canPair
      redirectUri
    }
  }
`);

/**
 * What a pairing or an unpairing changes, asked again by name: the setup, the login page's buttons, and Settings.
 * None of their answers has an id the cache could update in place.
 */
export const SSO_REFETCH = ['SsoSetup', 'AuthConfig', 'Settings'];

/** What the login page's button calls a provider that gave no name. The server's `AUTH_DEFAULTS.oidcName`. */
export const UNNAMED_PROVIDER = 'SSO';

/** Where the provider comes from: the server's `SsoSource`. */
export const SsoSource = { Env: 'ENV', Paired: 'PAIRED', None: 'NONE' } as const;

/** Why pairing failed: the server's `PairingFailure`, sent as `extensions.reason`. */
export const PairingFailure = {
  BadUrl: 'BAD_URL',
  NotAProvider: 'NOT_A_PROVIDER',
  NoRegistration: 'NO_REGISTRATION',
  Expired: 'EXPIRED',
  Refused: 'REFUSED',
  RateLimited: 'RATE_LIMITED',
} as const;
export type PairingFailure = (typeof PairingFailure)[keyof typeof PairingFailure];

/** What a refusal is headed with, by its reason. The server's message under it says what to do. */
const TITLES: ReadonlyMap<string, string> = new Map<PairingFailure, string>([
  [PairingFailure.BadUrl, "That isn't a setup URL"],
  [PairingFailure.NotAProvider, "Ravocal couldn't use that provider"],
  [PairingFailure.NoRegistration, "That provider can't pair by setup URL"],
  [PairingFailure.Expired, 'That setup URL has expired'],
  [PairingFailure.Refused, 'The provider refused'],
  [PairingFailure.RateLimited, 'Wait before trying again'],
]);

/** What a pairing or disconnecting that failed tells the reader. */
export interface PairingProblem {
  title: string;
  /** The server's sentence: what went wrong and what to do. It never carries the setup token. */
  description: string;
}

/**
 * Says why pairing or disconnecting failed.
 *
 * @param error - What the mutation failed with.
 * @param fallbackTitle - The heading for a failure that gives no reason: a refusal, or the network.
 * @returns The heading and the sentence to show the reader.
 */
export function describePairingError(error: unknown, fallbackTitle: string): PairingProblem {
  const reason = errorReason(error);
  const title = (reason === undefined ? undefined : TITLES.get(reason)) ?? fallbackTitle;
  return { title, description: describeError(error) };
}
