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
  /** What a field costs when nothing prices it. The hand-written schema prices nothing yet. */
  defaultFieldCost: number;
}

export const OPERATION_LIMIT_DEFAULTS: Readonly<OperationLimitSettings> = Object.freeze({
  maxTokens: 1000,
  maxDepth: 8,
  maxAliases: 15,
  maxCost: 10_000,
  defaultFieldCost: 1,
});

/** Sign-in and credential settings. */
export interface AuthSettings {
  /** How long a session token works after sign-in. Long: there is no password to fall back on. */
  sessionTtlDays: number;
  /** How long an emailed sign-in link works. Short: it travels by mail. */
  magicLinkTtlMinutes: number;
  /** Random bytes in a sign-in or invite token. */
  tokenBytes: number;
  /** Shortest signing secret production accepts, in characters. `openssl rand -hex 32` gives twice this. */
  minSecretLength: number;
}

export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  sessionTtlDays: 30,
  magicLinkTtlMinutes: 15,
  tokenBytes: 32,
  minSecretLength: 32,
});

/** Limits on a group and its invites. */
export interface GroupSettings {
  /** Longest group name, in characters. */
  maxNameLength: number;
  /** How long an emailed invite works. */
  inviteTtlDays: number;
}

export const GROUP_DEFAULTS: Readonly<GroupSettings> = Object.freeze({
  maxNameLength: 100,
  inviteTtlDays: 7,
});

/** How free time is cut into slots. */
export interface ScheduleSettings {
  /** The grid time blocks align to, and the length of one vote slot. Also the shortest block. */
  slotMinutes: number;
}

export const SCHEDULE_DEFAULTS: Readonly<ScheduleSettings> = Object.freeze({
  slotMinutes: 30,
});

/** Outgoing email. */
export interface EmailSettings {
  /** The SMTP port when `SMTP_PORT` is unset. */
  smtpPort: number;
  /** The From address when `EMAIL_FROM` is unset. */
  from: string;
}

export const EMAIL_DEFAULTS: Readonly<EmailSettings> = Object.freeze({
  smtpPort: 587,
  from: 'noreply@localhost',
});
