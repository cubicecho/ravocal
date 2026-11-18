// Getters, not constants, so a test (or a reload) sees the current environment.
import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS } from '@cubicecho/ravocal-db/defaults';
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
