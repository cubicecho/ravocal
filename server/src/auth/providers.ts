import { getOAuthState } from 'better-auth/api';
import { type GenericOAuthConfig, genericOAuth } from 'better-auth/plugins';
import { type ClientProviderConfig, type OidcProviderConfig, type ProviderConfig, ProviderId } from '../core/config.ts';

// Google and Facebook through better-auth's generic OAuth plugin rather than its built-in social providers, whose
// endpoints are fixed: here each provider's endpoints are an argument, so the tests run the whole sign-in against a
// stand-in on a loopback port. better-auth still runs the flow (state, PKCE, the id token, the account rows). The
// instance's own OIDC provider (OIDC_ISSUER, or a pairing: sso/settings.ts) goes through the same plugin, found by its
// issuer's discovery document.

/** Where each provider is reached. */
export interface ProviderEndpoints {
  /** Google's OpenID Connect discovery document: its endpoints, its keys and its issuer. */
  google: { discoveryUrl: string };
  /** Facebook Login, which has no discovery document: the login dialog, the code exchange and the profile. */
  facebook: { authorizationUrl: string; tokenUrl: string; profileUrl: string };
}

/** The Graph API version Facebook's endpoints are pinned to, as better-auth's own Facebook provider pins it. */
const FACEBOOK_GRAPH_VERSION = 'v24.0';

/** The real providers. Only tests pass others, through `createAuth`; nothing reads them from the environment. */
export const PROVIDER_ENDPOINTS: Readonly<ProviderEndpoints> = Object.freeze({
  google: Object.freeze({ discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration' }),
  facebook: Object.freeze({
    authorizationUrl: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    profileUrl: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me?fields=id,name,email,picture`,
  }),
});

/** What Facebook's `/me` answers with the fields asked for. `email` is absent when the reader has none or withheld it. */
interface FacebookProfile {
  id: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

/**
 * Whether the callback running now finishes a link that a signed-in reader started in Settings, rather than a sign-in.
 *
 * @returns true when better-auth's state for this callback names the account being linked to.
 */
async function isLinking(): Promise<boolean> {
  const state = await getOAuthState();
  return state?.link !== undefined;
}

/**
 * Google, through its discovery document. Its id token is verified against Google's keys and bound to the sign-in by
 * a nonce. No provider is trusted by name: an address signs in to the account that has it only when Google's own
 * `email_verified` claim says Google checked it, and otherwise is refused with `account_not_linked`.
 *
 * @param provider - The client.
 * @param endpoints - Where Google is.
 * @returns The plugin's configuration for Google.
 */
function google(provider: ClientProviderConfig, endpoints: ProviderEndpoints): GenericOAuthConfig {
  return {
    providerId: provider.id,
    name: provider.name,
    discoveryUrl: endpoints.google.discoveryUrl,
    requireIdTokenVerification: true,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    tokenEndpointAuth: { method: 'client_secret_basic' },
    pkce: true,
    scopes: ['openid', 'email', 'profile'],
    // Stated rather than left to the plugin's default reading, so an upgrade cannot quietly trust an unchecked address.
    mapProfileToUser: (profile) => ({ emailVerified: isTrue(profile.email_verified) }),
  };
}

/**
 * Reads a claim that should be true, which some providers send as the string "true".
 *
 * @param claim - The claim as the provider sent it.
 * @returns true only for `true` or "true".
 */
function isTrue(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

/**
 * Facebook, through explicit endpoints and the Graph API's `/me`.
 *
 * @remarks
 * Facebook never vouches for an address, so a Facebook sign-in whose address an account already has is refused with
 * `account_not_linked`. Connecting Facebook from Settings is a signed-in reader's own choice and links to that reader,
 * so only then is the address counted as checked, which is what better-auth asks of a provider it does not trust.
 *
 * @param provider - The client.
 * @param endpoints - Where Facebook is.
 * @returns The plugin's configuration for Facebook.
 */
function facebook(provider: ClientProviderConfig, endpoints: ProviderEndpoints): GenericOAuthConfig {
  return {
    providerId: provider.id,
    name: provider.name,
    authorizationUrl: endpoints.facebook.authorizationUrl,
    tokenUrl: endpoints.facebook.tokenUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    tokenEndpointAuth: { method: 'client_secret_post' },
    // As better-auth's own Facebook provider: the state and the client secret carry the code exchange.
    pkce: false,
    scopes: ['email', 'public_profile'],
    getUserInfo: async (tokens) => {
      const response = await fetch(endpoints.facebook.profileUrl, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      if (response.ok === false) {
        return null;
      }
      const profile: FacebookProfile = await response.json();
      return {
        id: profile.id,
        name: profile.name ?? '',
        email: profile.email,
        image: profile.picture?.data?.url,
        emailVerified: await isLinking(),
      };
    },
  };
}

/**
 * Reads a claim that should be text.
 *
 * @param claim - The claim as the provider sent it.
 * @returns The text, or undefined when it is missing, blank or not a string.
 */
function textClaim(claim: unknown): string | undefined {
  return typeof claim === 'string' && claim.trim() !== '' ? claim : undefined;
}

/**
 * The instance's own OpenID Connect provider, through its issuer's discovery document. Its id token is verified
 * against the issuer's keys, and PKCE binds the code to the sign-in.
 *
 * @remarks
 * Trusted no more than Google: an address signs in to the account that has it only when the provider's own
 * `email_verified` claim says it checked it, and a missing claim counts as unchecked.
 *
 * @param provider - The client: from the environment, or the one pairing registered.
 * @returns The plugin's configuration for it.
 */
function oidc(provider: OidcProviderConfig): GenericOAuthConfig {
  return {
    providerId: provider.id,
    name: provider.name,
    discoveryUrl: `${provider.issuer}/.well-known/openid-configuration`,
    requireIdTokenVerification: true,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    // A public client has no secret to send, and proves itself with PKCE alone.
    tokenEndpointAuth: { method: provider.clientSecret === undefined ? 'none' : provider.clientAuth },
    pkce: true,
    scopes: ['openid', 'profile', 'email'],
    // A provider may release only a username, or no name at all: then the address's local part.
    mapProfileToUser: (profile) => ({
      name:
        textClaim(profile.name) ??
        textClaim(profile.preferred_username) ??
        textClaim(profile.email)?.split('@')[0] ??
        '',
      emailVerified: isTrue(profile.email_verified),
    }),
  };
}

/**
 * Configures one provider.
 *
 * @param provider - The provider.
 * @param endpoints - Where Google and Facebook are. The OIDC provider is found by its issuer.
 * @returns The plugin's configuration for it.
 */
function pluginConfig(provider: ProviderConfig, endpoints: ProviderEndpoints): GenericOAuthConfig {
  switch (provider.id) {
    case ProviderId.Google:
      return google(provider, endpoints);
    case ProviderId.Facebook:
      return facebook(provider, endpoints);
    case ProviderId.Oidc:
      return oidc(provider);
  }
}

/**
 * Registers the providers with better-auth, which then serves them through its own `signInSocial`, `linkSocialAccount`
 * and `/callback/:id`.
 *
 * @param providers - The providers to offer. At least one.
 * @param endpoints - Where they are reached.
 * @returns The plugin.
 */
export function providersPlugin(providers: readonly ProviderConfig[], endpoints: ProviderEndpoints) {
  return genericOAuth({
    config: providers.map((provider) => pluginConfig(provider, endpoints)),
  });
}
