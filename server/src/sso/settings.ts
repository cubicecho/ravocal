import type { DB } from '@cubicecho/ravocal-db';
import { type NewOidcSettings, oidcSettings } from '@cubicecho/ravocal-db/schema';
import { OIDC_CLIENT_AUTH_METHODS, type OidcClientAuth, type OidcConfig, oidcConfig } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';

// The OIDC provider the instance signs in with comes from one of two places: the environment (OIDC_ISSUER and
// OIDC_CLIENT_ID), or a pairing made by pasting a setup URL (pairing.ts), kept in the `oidc_settings` row. This file is
// the one place that decides between them. The environment wins, so a deployment that pins its provider cannot be
// re-paired from the app.

/** Where the provider in use came from. The GraphQL enum `SsoSource` has the same values. */
export const SsoSource = {
  Env: 'ENV',
  Paired: 'PAIRED',
  None: 'NONE',
} as const;
export type SsoSource = (typeof SsoSource)[keyof typeof SsoSource];

/** The `oidc_settings` row, as pairing writes it. */
export interface PairedOidc {
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  clientAuth: OidcClientAuth;
  name: string;
  /** RFC 7592: the credential that deletes the client at the provider. */
  registrationAccessToken: string | null;
  registrationClientUri: string | null;
}

/** The provider in use, and where it came from. */
export interface EffectiveOidc {
  config: OidcConfig | null;
  source: SsoSource;
}

/**
 * Reads a stored client auth method.
 *
 * @param value - The column.
 * @returns The method, or the default for anything it does not know.
 */
function clientAuthOf(value: string): OidcClientAuth {
  return OIDC_CLIENT_AUTH_METHODS.find((method) => method === value) ?? AUTH_DEFAULTS.oidcClientAuth;
}

/**
 * Reads the paired provider.
 *
 * @param db - The database.
 * @returns The pairing, or null when there is none.
 */
export async function readPairedOidc(db: DB): Promise<PairedOidc | null> {
  const [row] = await db.select().from(oidcSettings).limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    clientAuth: clientAuthOf(row.clientAuth),
    name: row.name,
    registrationAccessToken: row.registrationAccessToken,
    registrationClientUri: row.registrationClientUri,
  };
}

/**
 * Saves a pairing, replacing any before it.
 *
 * @param db - The database.
 * @param paired - What the provider registered.
 */
export async function savePairedOidc(db: DB, paired: PairedOidc): Promise<void> {
  const row: NewOidcSettings = paired;
  await db
    .insert(oidcSettings)
    .values(row)
    .onConflictDoUpdate({ target: oidcSettings.id, set: { ...row, updatedAt: new Date() } });
}

/**
 * Forgets the pairing.
 *
 * @param db - The database.
 */
export async function clearPairedOidc(db: DB): Promise<void> {
  await db.delete(oidcSettings);
}

/**
 * Reads the provider sign-in uses and where it came from.
 *
 * @param db - The database.
 * @returns The environment's provider when OIDC_ISSUER and OIDC_CLIENT_ID are set, otherwise the pairing, otherwise
 *   none.
 */
export async function effectiveOidc(db: DB): Promise<EffectiveOidc> {
  const env = oidcConfig();
  if (env !== null) {
    return { config: env, source: SsoSource.Env };
  }
  const paired = await readPairedOidc(db);
  if (paired === null) {
    return { config: null, source: SsoSource.None };
  }
  return {
    config: {
      issuer: paired.issuer,
      clientId: paired.clientId,
      clientSecret: paired.clientSecret ?? undefined,
      clientAuth: paired.clientAuth,
      name: paired.name,
    },
    source: SsoSource.Paired,
  };
}
