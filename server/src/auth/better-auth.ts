import type { DB } from '@cubicecho/ravocal-db';
import { accounts, sessions, users, verifications } from '@cubicecho/ravocal-db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink, oneTimeToken } from 'better-auth/plugins';
import { appUrl, authSecret, type ProviderConfig, providerConfigs, serverUrl, smtpConfigured } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { SECONDS_PER_DAY, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { sendMagicLinkEmail } from './email.ts';
import { PROVIDER_ENDPOINTS, type ProviderEndpoints, providersPlugin } from './providers.ts';
import { revokeUnprovenAccess } from './unproven-access.ts';

/** better-auth's id for the magic-link plugin. */
const MAGIC_LINK_PLUGIN_ID = 'magic-link';

/** Where a sign-in link lands in the app, which spends its token through `magicLinkVerify`. */
export const MAGIC_LINK_PATH = '/auth/verify';
/** The app's sign-in page, which reads `?error=` and says why a provider's sign-in failed. */
export const LOGIN_PATH = '/login';

/** What delivering one sign-in link is given. */
export interface MagicLink {
  email: string;
  /** The link to the app, with the token in its query. */
  url: string;
  token: string;
}

/** Overrides for tests. Production uses the defaults. */
export interface AuthOptions {
  /** What better-auth signs with. The default is `authSecret()`. */
  secret?: string;
  /**
   * Delivers a sign-in link; tests pass a fake that captures it. The default is `sendMagicLinkEmail` when SMTP is
   * configured, and no links at all otherwise.
   */
  sendMagicLink?: (link: MagicLink) => Promise<void>;
  /** The providers to sign in with. The default is `providerConfigs()`, the environment's. */
  providers?: readonly ProviderConfig[];
  /** Where the providers are reached. Tests point them at a stand-in; the default is the real ones. */
  providerEndpoints?: ProviderEndpoints;
}

/**
 * Builds the better-auth instance. Server code calls `auth.api.*`, and of its REST routes only a provider's callback
 * is served (http/sso.ts).
 *
 * @param db - The database users, sessions and pending links are kept in.
 * @param [options] - Test overrides.
 * @returns The auth instance.
 */
export function createAuth(
  db: DB,
  {
    secret = authSecret(),
    sendMagicLink,
    providers = providerConfigs(),
    providerEndpoints = PROVIDER_ENDPOINTS,
  }: AuthOptions = {},
) {
  const smtpDelivery = smtpConfigured() ? sendMagicLinkEmail : undefined;
  const deliver = sendMagicLink ?? smtpDelivery;
  const magicLinkPlugins =
    deliver === undefined
      ? []
      : [
          magicLink({
            // better-auth takes seconds.
            expiresIn: AUTH_DEFAULTS.magicLinkTtlMinutes * SECONDS_PER_MINUTE,
            storeToken: 'hashed',
            // Links go to the app, which calls magicLinkVerify over GraphQL. The REST verify route is not mounted.
            sendMagicLink: ({ email, token }) =>
              deliver({ email, token, url: `${appUrl()}${MAGIC_LINK_PATH}?token=${encodeURIComponent(token)}` }),
          }),
        ];

  return betterAuth({
    // The rc drizzle instance is keyed by relations, so the adapter cannot discover tables itself.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secret,
    // A provider's callback is served here (http/sso.ts), so its redirect URI is built from this.
    baseURL: serverUrl(),
    // So a provider's sign-in may finish on the app's pages, wherever they are served from.
    trustedOrigins: [new URL(appUrl()).origin],
    advanced: { database: { generateId: 'uuid' } },
    session: { expiresIn: AUTH_DEFAULTS.sessionTtlDays * SECONDS_PER_DAY },
    account: {
      accountLinking: {
        enabled: true,
        // No provider is trusted by name: a sign-in reaches the account that has its address only when the provider
        // says it checked the address (Google's email_verified; Facebook never does, providers.ts).
        // So a Google-checked address reaches an account made under SECURE_LOCAL_NET too, whose address nobody checked.
        requireLocalEmailVerified: false,
        // Connecting a provider in Settings links it to the signed-in reader, whatever address it has.
        allowDifferentEmails: true,
        // Ravocal keeps its own rule on the last way to sign in (unlinkAccount in endpoints.ts).
        allowUnlinkingAll: true,
      },
    },
    // When an address is first proven, the ways in it did not vouch for stop working (unproven-access.ts).
    databaseHooks: revokeUnprovenAccess,
    // Where a callback goes when it cannot tell where the sign-in came from: the login page, which says so.
    onAPIError: { errorURL: `${appUrl()}${LOGIN_PATH}` },
    plugins: [
      // bearer: sign-in answers with the session token, and the client sends it back as `Authorization: Bearer`.
      bearer(),
      // How a provider's sign-in reaches the app: the callback mints one, and /auth/sso spends it over GraphQL. The
      // session never rides in a URL or a cookie.
      oneTimeToken({
        expiresIn: AUTH_DEFAULTS.oneTimeTokenTtlMinutes,
        storeToken: 'hashed',
        disableClientRequest: true,
        disableSetSessionCookie: true,
      }),
      ...(providers.length === 0 ? [] : [providersPlugin(providers, providerEndpoints)]),
      ...magicLinkPlugins,
    ],
  });
}

/** The better-auth instance `createAuth` builds. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * Whether this instance emails sign-in links.
 *
 * @param auth - The auth instance.
 * @returns true when it was built with a way to deliver them.
 */
export function sendsMagicLinks(auth: Auth): boolean {
  return auth.options.plugins.some((plugin) => plugin.id === MAGIC_LINK_PLUGIN_ID);
}

/**
 * Picks out the cookies better-auth set that are not the session's. Ravocal's session is a bearer token, never a
 * cookie, but a provider's state cookie has to reach the browser for its callback to be accepted.
 *
 * @param auth - The auth instance that set them.
 * @param headers - The headers of what it answered.
 * @returns The `Set-Cookie` values to send on, the session's left out.
 */
export async function nonSessionCookies(auth: Auth, headers: Headers): Promise<string[]> {
  const { authCookies } = await auth.$context;
  const sessionCookies = new Set([authCookies.sessionToken.name, authCookies.sessionData.name]);
  return headers.getSetCookie().filter((cookie) => sessionCookies.has(cookie.slice(0, cookie.indexOf('='))) === false);
}

/**
 * Reads who a request's session belongs to.
 *
 * @param auth - The auth instance.
 * @param headers - The request's headers, carrying `Authorization: Bearer`.
 * @returns The user's id, or null when there is no live session.
 */
export async function sessionUserId(auth: Auth, headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user.id ?? null;
}
