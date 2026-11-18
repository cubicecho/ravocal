// Getters, not constants, so a test (or a reload) sees the current environment.
import { DATABASE_DEFAULTS } from '@cubicecho/ravocal-db/defaults';
import { AUTH_DEFAULTS, EMAIL_DEFAULTS, HTTP_DEFAULTS } from './defaults.ts';

const NODE_ENV_PRODUCTION = 'production';

/** What signs session tokens when `JWT_SECRET` is unset. Preflight refuses it in production. */
export const DEV_SECRET = 'dev-secret-change-in-production';
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
 * The session-token signing secret as set. Preflight checks this one.
 *
 * @returns `JWT_SECRET`, or undefined when it is unset or empty.
 */
export const configuredJwtSecret = (): string | undefined => envString(process.env.JWT_SECRET);

/**
 * Why `secret` must not sign production tokens, or undefined when it may.
 *
 * @param secret - `JWT_SECRET` as set.
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
 * What session tokens are signed and checked with.
 *
 * @returns `JWT_SECRET`, or `DEV_SECRET` when unset, so development needs no .env entry.
 */
export const jwtSecret = (): string => configuredJwtSecret() ?? DEV_SECRET;

/**
 * The SMTP server to send through. Unset means emails are printed to the console instead.
 *
 * @returns `SMTP_HOST`, or undefined.
 */
export const smtpHost = (): string | undefined => envString(process.env.SMTP_HOST);

/**
 * The SMTP server's port.
 *
 * @returns `SMTP_PORT`, or `EMAIL_DEFAULTS.smtpPort`.
 */
export const smtpPort = (): number => envNumber(process.env.SMTP_PORT, EMAIL_DEFAULTS.smtpPort);

/**
 * The SMTP login. Unset means no authentication.
 *
 * @returns `SMTP_USER`, or undefined.
 */
export const smtpUser = (): string | undefined => envString(process.env.SMTP_USER);

/**
 * The SMTP password, read only alongside `smtpUser`.
 *
 * @returns `SMTP_PASS`, or undefined.
 */
export const smtpPass = (): string | undefined => envString(process.env.SMTP_PASS);

/**
 * The From address on every email.
 *
 * @returns `EMAIL_FROM`, or `EMAIL_DEFAULTS.from`.
 */
export const emailFrom = (): string => envString(process.env.EMAIL_FROM) ?? EMAIL_DEFAULTS.from;
