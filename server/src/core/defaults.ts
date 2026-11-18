// Every value someone might tune, as plain data. Nothing here computes, reads the environment or imports.

/** Settings for the HTTP door and the process behind it. */
export interface HttpSettings {
  /** The port to listen on. `PORT` overrides it. The Vite dev server proxies /graphql to it. */
  port: number;
  /** Largest JSON body /graphql accepts, as `express.json` reads it. Real operations are a few kB. */
  bodyLimit: string;
  /** How long shutdown lets open requests finish before it cuts them. */
  drainSeconds: number;
  /** How long shutdown may take in all before a hard exit. Keep it under Docker's 10 s. */
  shutdownDeadlineSeconds: number;
  /** Express `trust proxy`: which hops may set X-Forwarded-For. False trusts none. `TRUST_PROXY` overrides it. */
  trustProxy: boolean | number | string;
}

export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  port: 3001,
  bodyLimit: '1mb',
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
  trustProxy: false,
});

/** Bounds on one GraphQL operation. */
export interface OperationLimitSettings {
  /** Rows a list returns when the request names no `limit`: root lists and to-many relations alike. */
  defaultPageSize: number;
  /** The largest `limit` a request may ask for. A larger one is refused, never trimmed. */
  maxPageSize: number;
  /**
   * Tokens per document, counted while it is parsed. graphql-js compares repeated fields pairwise, so ten thousand
   * copies of one field (about 30 kB) cost seconds of CPU before depth or cost is checked. The app's largest
   * operation is about 80 tokens and a full introspection query about 190.
   */
  maxTokens: number;
  /** Deepest selection accepted. Inline fragments and fragment spreads count as a level each. */
  maxDepth: number;
  /** Aliases per operation. */
  maxAliases: number;
  /** Cost per operation. */
  maxCost: number;
  /** What a field costs when nothing prices it: the generated lists price themselves by their page size. */
  defaultFieldCost: number;
}

export const OPERATION_LIMIT_DEFAULTS: Readonly<OperationLimitSettings> = Object.freeze({
  defaultPageSize: 50,
  maxPageSize: 500,
  maxTokens: 1000,
  maxDepth: 8,
  maxAliases: 15,
  maxCost: 10_000,
  defaultFieldCost: 1,
});

/** The sign-in throttle. */
export interface RateLimitSettings {
  /** Attempts allowed per key inside one window. */
  maxAttempts: number;
  /** How long an attempt counts against its key. */
  windowMinutes: number;
  /** Past this many keys, a hit sweeps out the ones whose window has passed. */
  sweepAtKeys: number;
}

export const RATE_LIMIT_DEFAULTS: Readonly<RateLimitSettings> = Object.freeze({
  maxAttempts: 5,
  windowMinutes: 15,
  sweepAtKeys: 10_000,
});

/** Sign-in and credential settings. */
export interface AuthSettings {
  /** How long a session lasts after it was last used. Long: there is no password to fall back on. */
  sessionTtlDays: number;
  /** How long an emailed sign-in link works. Short: it travels by mail. */
  magicLinkTtlMinutes: number;
  /** Shortest signing secret production accepts, in characters. `openssl rand -hex 32` gives twice this. */
  minSecretLength: number;
  /** Whether typing an email signs in, with no link. Unsafe on a public network. `SECURE_LOCAL_NET` overrides it. */
  secureLocalNet: boolean;
  /**
   * How long the token a provider's callback hands the app works: the hop from the callback to `/auth/sso`. Short: it
   * travels in a URL.
   */
  oneTimeTokenTtlMinutes: number;
  /** What the login page's button calls an OIDC provider that gives no name of its own. `OIDC_NAME` overrides it. */
  oidcName: string;
  /** How a confidential OIDC client sends its secret when `OIDC_CLIENT_AUTH` is unset. */
  oidcClientAuth: 'client_secret_basic' | 'client_secret_post';
  /** How long pairing waits on each call to the provider (discovery, registration, deletion). */
  oidcPairingTimeoutMs: number;
  /**
   * How long a provider's sign-in waits on a profile endpoint Ravocal calls itself (Facebook's Graph `/me`). Past it,
   * the reader counts as having no profile and is sent back to the login page.
   */
  providerTimeoutMs: number;
}

export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  sessionTtlDays: 30,
  magicLinkTtlMinutes: 15,
  minSecretLength: 32,
  secureLocalNet: false,
  oneTimeTokenTtlMinutes: 3,
  oidcName: 'SSO',
  oidcClientAuth: 'client_secret_basic',
  oidcPairingTimeoutMs: 10_000,
  providerTimeoutMs: 10_000,
});

/** Limits on what a user may call themselves. */
export interface UserSettings {
  /** Longest name, in characters. */
  maxNameLength: number;
}

export const USER_DEFAULTS: Readonly<UserSettings> = Object.freeze({
  maxNameLength: 100,
});

/** Limits on a group and its invites. */
export interface GroupSettings {
  /** Longest group name, in characters. */
  maxNameLength: number;
  /** How long an invite link works. */
  inviteTtlDays: number;
  /** Longest address an invite is sent to, in characters: the most an address may hold. */
  maxInviteEmailLength: number;
}

export const GROUP_DEFAULTS: Readonly<GroupSettings> = Object.freeze({
  maxNameLength: 100,
  inviteTtlDays: 7,
  maxInviteEmailLength: 254,
});

/** How free time is cut into slots. */
export interface ScheduleSettings {
  /** The grid time blocks align to, and the length of one vote slot. Also the shortest block. */
  slotMinutes: number;
}

export const SCHEDULE_DEFAULTS: Readonly<ScheduleSettings> = Object.freeze({
  slotMinutes: 30,
});
