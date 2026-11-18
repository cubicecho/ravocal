// Every value someone might tune, as plain data. Nothing here computes, reads the environment or imports.

/** Settings for the HTTP door and the process behind it. */
export interface HttpSettings {
  /** The port to listen on. `PORT` overrides it. The Vite dev server proxies /graphql to it. */
  port: number;
}

export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  port: 3001,
});

/** Sign-in and credential settings. */
export interface AuthSettings {
  /** How long a session token works after sign-in. Long: there is no password to fall back on. */
  sessionTtlDays: number;
  /** How long an emailed sign-in link works. Short: it travels by mail. */
  magicLinkTtlMinutes: number;
  /** Random bytes in a sign-in or invite token. */
  tokenBytes: number;
}

export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  sessionTtlDays: 30,
  magicLinkTtlMinutes: 15,
  tokenBytes: 32,
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
