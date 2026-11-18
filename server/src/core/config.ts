// Getters, not constants, so a test (or a reload) sees the current environment.
import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS } from '@cubicecho/ravocal-db/defaults';
import { hostOf, isPrivateHost } from '@cubicecho/ravocal-db/ssl';
import { AUTH_DEFAULTS, HTTP_DEFAULTS } from './defaults.ts';

const NODE_ENV_PRODUCTION = 'production';
/** The TRUST_PROXY value that trusts no hop. */
const TRUST_PROXY_OFF = 'false';
/** A hop count: digits only. */
const HOP_COUNT = /^\d+$/;
const UNKNOWN_VERSION = 'unknown';
/** The flag values that mean on. Anything else set means off. */
const FLAG_ON = new Set(['1', 'true', 'yes']);
/** The local part of the From address when `SMTP_FROM` is unset. */
const DEFAULT_FROM_LOCAL_PART = 'ravocal';

/**
 * What signs sessions when `BETTER_AUTH_SECRET` is unset. Preflight refuses it in production. 32 characters or more,
 * or better-auth warns about it on every start.
 */
export const DEV_SECRET = 'dev-secret-change-me-in-production';
/** The value `.env.example` ships. Public, so as good as no secret at all. */
export const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

/**
 * Reads a positive number.
 *
 * @param value - The raw env value.
 * @param fallback - Used when the value is unset, not a number, or not above zero.
 * @returns The number.
 */
function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  const isUsable = Number.isFinite(parsed) && parsed > 0;
  return isUsable ? parsed : fallback;
}

/**
 * Reads a string that may be unset.
 *
 * @param value - The raw env value.
 * @returns The value, or undefined when it is unset or empty.
 */
function envString(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Reads an on/off flag.
 *
 * @param value - The raw env value.
 * @param fallback - Used when the value is unset or blank.
 * @returns true for "1", "true" or "yes" in any case, false for anything else set.
 */
function envFlag(value: string | undefined, fallback: boolean): boolean {
  const trimmed = (value ?? '').trim().toLowerCase();
  return trimmed === '' ? fallback : FLAG_ON.has(trimmed);
}

/**
 * The port to listen on.
 *
 * @returns `PORT`, or `HTTP_DEFAULTS.port`.
 */
export const port = (): number => envNumber(process.env.PORT, HTTP_DEFAULTS.port);

/**
 * Where people open the app. Sign-in and invite links are built from it.
 *
 * @returns `APP_URL`, or localhost on the listen port.
 */
export const appUrl = (): string => envString(process.env.APP_URL) ?? `http://localhost:${port()}`;

/**
 * Where a browser reaches this server: the provider sign-in's start and callback, and so the redirect URIs registered
 * with each provider.
 *
 * @remarks
 * In production the server serves the app, and in development Vite proxies `/sso` and `/api/auth` to it, so both are
 * `APP_URL` unless the server is reached some other way.
 *
 * @returns `SERVER_URL`, or `appUrl()`.
 */
export const serverUrl = (): string => envString(process.env.SERVER_URL) ?? appUrl();

/**
 * Whether this is a production run. Preflight is stricter and GraphiQL is off.
 *
 * @returns True when `NODE_ENV` is "production".
 */
export const isProduction = (): boolean => process.env.NODE_ENV === NODE_ENV_PRODUCTION;

/**
 * How long boot waits for Postgres before exiting.
 *
 * @returns `DB_CONNECT_TIMEOUT_MS`, or `DATABASE_DEFAULTS.connectTimeoutMs`, in milliseconds.
 */
export const dbConnectTimeoutMs = (): number =>
  envNumber(process.env.DB_CONNECT_TIMEOUT_MS, DATABASE_DEFAULTS.connectTimeoutMs);

/**
 * Express `trust proxy`: which hops may set X-Forwarded-For, and so what `req.ip` is.
 *
 * @remarks
 * `ctx.ip` is read from `req.ip`. Never `true` on a port the internet reaches directly: any client could then
 * choose its own address.
 *
 * @returns `HTTP_DEFAULTS.trustProxy` when `TRUST_PROXY` is unset, false for "false", a hop count for digits,
 * otherwise the value as given ("loopback", an address list).
 */
export const trustProxy = (): boolean | number | string => {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  if (raw === '') {
    return HTTP_DEFAULTS.trustProxy;
  }
  if (raw === TRUST_PROXY_OFF) {
    return false;
  }
  const isHopCount = HOP_COUNT.test(raw);
  return isHopCount ? Number(raw) : raw;
};

/**
 * Reads the version in the root package.json, which the Dockerfile copies.
 *
 * @returns The version, or "unknown".
 */
function readVersion(): string {
  try {
    const manifest: { version?: string } = createRequire(import.meta.url)('../../../package.json');
    return manifest.version || UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/** Stamped into the build, not configured. */
const VERSION = readVersion();

/**
 * The version this build was released as.
 *
 * @returns The version, or "unknown".
 */
export const version = (): string => VERSION;

/**
 * What better-auth signs with, as set. Preflight checks this one.
 *
 * @returns `BETTER_AUTH_SECRET`, or undefined when it is unset or empty.
 */
export const configuredAuthSecret = (): string | undefined => envString(process.env.BETTER_AUTH_SECRET);

/**
 * Why `secret` must not sign production sessions, or undefined when it may.
 *
 * @param secret - `BETTER_AUTH_SECRET` as set.
 * @returns The reason, as the end of a sentence ("is not set").
 */
export function describeWeakSecret(secret: string | undefined): string | undefined {
  if (secret === undefined || secret === '') {
    return 'is not set';
  }
  if (secret === DEV_SECRET || secret === PLACEHOLDER_SECRET) {
    return 'is a published default';
  }
  if (secret.length < AUTH_DEFAULTS.minSecretLength) {
    return `is shorter than ${AUTH_DEFAULTS.minSecretLength} characters`;
  }
  return undefined;
}

/**
 * What better-auth signs sessions with.
 *
 * @returns `BETTER_AUTH_SECRET`, or `DEV_SECRET` when unset, so development needs no .env entry.
 */
export const authSecret = (): string => configuredAuthSecret() ?? DEV_SECRET;

/**
 * Whether typing an email address signs in, with no link to follow. The network is then the credential, so
 * preflight refuses it with a public `APP_URL`.
 *
 * @returns `SECURE_LOCAL_NET` as a flag, or `AUTH_DEFAULTS.secureLocalNet` when unset.
 */
export const secureLocalNet = (): boolean => envFlag(process.env.SECURE_LOCAL_NET, AUTH_DEFAULTS.secureLocalNet);

/**
 * Whether a public `APP_URL` is accepted alongside `SECURE_LOCAL_NET`.
 *
 * @returns `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC` as a flag, off when unset.
 */
export const allowsPublicLocalNet = (): boolean => envFlag(process.env.I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC, false);

/**
 * Where email is sent through, as a nodemailer connection URL (`smtp://user:pass@host:587`).
 *
 * @returns `SMTP_URL`, or undefined when unset. Then no sign-in links are sent, and other emails are printed.
 */
export const smtpUrl = (): string | undefined => envString(process.env.SMTP_URL);

/**
 * Whether this instance can send email.
 *
 * @returns true when `SMTP_URL` is set.
 */
export const smtpConfigured = (): boolean => smtpUrl() !== undefined;

/**
 * The From address on every email.
 *
 * @returns `SMTP_FROM`, or `ravocal@` the host of `APP_URL`.
 */
export const smtpFrom = (): string =>
  envString(process.env.SMTP_FROM) ?? `${DEFAULT_FROM_LOCAL_PART}@${new URL(appUrl()).hostname}`;

/** Where better-auth's routes sit: its default base path. Only the provider callback under it is served. */
export const AUTH_BASE_PATH = '/api/auth';

/** The providers a reader can sign in with besides an email link, by the id better-auth registers each under. */
export const ProviderId = { Google: 'google', Facebook: 'facebook', Oidc: 'oidc' } as const;
export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId];
/** The providers whose client is a pair of variables: a client id and its secret. */
type ClientProviderId = typeof ProviderId.Google | typeof ProviderId.Facebook;

/** Google or Facebook: a provider this instance has an OAuth client with. */
export interface ClientProviderConfig {
  id: ClientProviderId;
  /** What the login page's button calls it: "Continue with Google". */
  name: string;
  clientId: string;
  clientSecret: string;
}

/** How a confidential OIDC client sends its secret to the token endpoint. The provider must expect the same. */
export type OidcClientAuth = 'client_secret_basic' | 'client_secret_post';
/** The `OIDC_CLIENT_AUTH` values a provider can expect. */
export const OIDC_CLIENT_AUTH_METHODS: readonly OidcClientAuth[] = ['client_secret_basic', 'client_secret_post'];

/** An OpenID Connect provider to sign in with, from the environment or a pairing (sso/settings.ts). */
export interface OidcConfig {
  /** The issuer URL, no trailing slash. Its discovery document is `/.well-known/openid-configuration` under it. */
  issuer: string;
  clientId: string;
  /** Unset for a public client, which proves itself with PKCE alone. */
  clientSecret: string | undefined;
  clientAuth: OidcClientAuth;
  /** What the login page's button calls the provider. */
  name: string;
}

/** The OIDC provider, as one of the providers sign-in offers. */
export interface OidcProviderConfig extends OidcConfig {
  id: typeof ProviderId.Oidc;
}

/** A provider sign-in offers. */
export type ProviderConfig = ClientProviderConfig | OidcProviderConfig;

/** What a provider is called, and the variables its client is read from. */
interface ProviderVariables {
  id: ClientProviderId;
  name: string;
  clientId: string;
  clientSecret: string;
}

/** Google and Facebook, in the order the login page lists them. */
const PROVIDER_VARIABLES: readonly ProviderVariables[] = Object.freeze([
  { id: ProviderId.Google, name: 'Google', clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  { id: ProviderId.Facebook, name: 'Facebook', clientId: 'FACEBOOK_CLIENT_ID', clientSecret: 'FACEBOOK_CLIENT_SECRET' },
]);

/**
 * Reads one provider's client from the environment.
 *
 * @param variables - The provider's name and variables.
 * @returns The client id and secret as set, each trimmed, and undefined when unset or blank.
 */
function providerClient(variables: ProviderVariables): { clientId?: string; clientSecret?: string } {
  return {
    clientId: envString(process.env[variables.clientId]?.trim()),
    clientSecret: envString(process.env[variables.clientSecret]?.trim()),
  };
}

/**
 * The providers set in the environment by a client id and secret: Google and Facebook. A provider is on when both its
 * client id and its secret are set. The OIDC provider is not among them: it may be paired, so it is read from the
 * database too (sso/settings.ts).
 *
 * @returns Each provider with a whole client, in the order the login page lists them.
 */
export function providerConfigs(): ClientProviderConfig[] {
  return PROVIDER_VARIABLES.flatMap((variables) => {
    const { clientId, clientSecret } = providerClient(variables);
    const isOff = clientId === undefined || clientSecret === undefined;
    return isOff ? [] : [{ id: variables.id, name: variables.name, clientId, clientSecret }];
  });
}

/**
 * Says which providers are half set up, for preflight to refuse: a client id without its secret, or the reverse.
 *
 * @returns One sentence per such provider, naming the variable that is missing.
 */
export function halfSetProviders(): string[] {
  return PROVIDER_VARIABLES.flatMap((variables) => {
    const { clientId, clientSecret } = providerClient(variables);
    const isHalfSet = (clientId === undefined) !== (clientSecret === undefined);
    if (isHalfSet === false) {
      return [];
    }
    const missing = clientId === undefined ? variables.clientId : variables.clientSecret;
    const set = clientId === undefined ? variables.clientSecret : variables.clientId;
    return [`${set} is set but ${missing} is not. Set both to offer sign-in with ${variables.name}, or neither.`];
  });
}

/**
 * Names the redirect URI to register with a provider.
 *
 * @param id - The provider.
 * @returns better-auth's callback for it, under `serverUrl()`.
 */
export function providerRedirectUri(id: ProviderId): string {
  return `${serverUrl()}${AUTH_BASE_PATH}/callback/${id}`;
}

/** A trailing slash, which an issuer is compared and stored without. */
const TRAILING_SLASHES = /\/+$/;

/**
 * Writes an issuer the one way it is compared and stored: without trailing slashes.
 *
 * @param issuer - The issuer as given.
 * @returns The same issuer with no trailing slash.
 */
export function normalizeIssuer(issuer: string): string {
  return issuer.replace(TRAILING_SLASHES, '');
}

/**
 * Reads the OIDC provider set in the environment. Preflight refuses one of `OIDC_ISSUER` and `OIDC_CLIENT_ID` without
 * the other, an issuer that is not a URL, and an `OIDC_CLIENT_AUTH` it does not know (`oidcConfigProblems`).
 *
 * @returns The provider when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are both set, otherwise null.
 */
export function oidcConfig(): OidcConfig | null {
  const issuer = envString(process.env.OIDC_ISSUER?.trim());
  const clientId = envString(process.env.OIDC_CLIENT_ID?.trim());
  if (issuer === undefined || clientId === undefined) {
    return null;
  }
  const clientAuth = OIDC_CLIENT_AUTH_METHODS.find((method) => method === process.env.OIDC_CLIENT_AUTH?.trim());
  return {
    issuer: normalizeIssuer(issuer),
    clientId,
    clientSecret: envString(process.env.OIDC_CLIENT_SECRET?.trim()),
    clientAuth: clientAuth ?? AUTH_DEFAULTS.oidcClientAuth,
    name: envString(process.env.OIDC_NAME?.trim()) ?? AUTH_DEFAULTS.oidcName,
  };
}

/**
 * Whether talking to a provider at this URL would carry its secrets and tokens in the clear across a network nobody
 * running Ravocal controls.
 *
 * @param url - An http(s) URL.
 * @returns true for an `http:` URL whose host is not this machine or a private network (`isPrivateHost`).
 */
export function isPublicHttp(url: string): boolean {
  return new URL(url).protocol === 'http:' && isPrivateHost(hostOf(url)) === false;
}

/**
 * Says what is wrong with the OIDC provider set in the environment, for preflight to refuse.
 *
 * @returns One sentence per problem: an issuer without a client id or the reverse, an issuer that is not a URL, in
 *   production an `http:` issuer on a public host (`isPublicHttp`), an `OIDC_CLIENT_AUTH` that is not one of
 *   `OIDC_CLIENT_AUTH_METHODS`.
 */
export function oidcConfigProblems(): string[] {
  const issuer = envString(process.env.OIDC_ISSUER?.trim());
  const clientId = envString(process.env.OIDC_CLIENT_ID?.trim());
  const clientAuth = envString(process.env.OIDC_CLIENT_AUTH?.trim());
  const problems: string[] = [];
  const isHalfSet = (issuer === undefined) !== (clientId === undefined);
  if (isHalfSet) {
    const [set, missing] = issuer === undefined ? ['OIDC_CLIENT_ID', 'OIDC_ISSUER'] : ['OIDC_ISSUER', 'OIDC_CLIENT_ID'];
    problems.push(`${set} is set but ${missing} is not. Set both to sign in with an OIDC provider, or neither.`);
  }
  const isBadIssuer = issuer !== undefined && /^https?:$/.test(URL.parse(issuer)?.protocol ?? '') === false;
  if (isBadIssuer) {
    problems.push(`OIDC_ISSUER (${issuer}) is not an http(s) URL. Set it to the provider's issuer URL.`);
  }
  const isCleartext = issuer !== undefined && isBadIssuer === false && isProduction() && isPublicHttp(issuer);
  if (isCleartext) {
    problems.push(
      `OIDC_ISSUER (${issuer}) is http:// on a public host, so the client secret and the sign-in's tokens would cross the network in the clear. Set it to the provider's https:// address.`,
    );
  }
  const isKnownClientAuth = OIDC_CLIENT_AUTH_METHODS.some((method) => method === clientAuth);
  if (clientAuth !== undefined && isKnownClientAuth === false) {
    problems.push(`OIDC_CLIENT_AUTH (${clientAuth}) must be one of ${OIDC_CLIENT_AUTH_METHODS.join(', ')}, or unset.`);
  }
  return problems;
}
