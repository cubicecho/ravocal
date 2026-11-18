import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The OIDC provider this instance was paired with (server/src/sso/pairing.ts): one row or none, owned by no user and
 * written only by the server. OIDC_ISSUER in the environment wins over it. The client secret and the registration
 * access token are credentials, so the table is never in the GraphQL schema (SERVER_TABLES).
 */
export const oidcSettings = pgTable(
  'oidc_settings',
  {
    id: text('id').primaryKey().default('oidc'),
    /** The issuer URL, no trailing slash. */
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    /** Null for a public client, which proves itself with PKCE alone. */
    clientSecret: text('client_secret'),
    /** How the secret is sent to the token endpoint: the method the provider registered. */
    clientAuth: text('client_auth').notNull().default('client_secret_basic'),
    /** What the login page's button calls the provider. */
    name: text('name').notNull(),
    /** RFC 7592: what deletes the registration at the provider when this instance disconnects. */
    registrationAccessToken: text('registration_access_token'),
    registrationClientUri: text('registration_client_uri'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('oidc_settings_singleton', sql`${table.id} = 'oidc'`)],
);

/** The pairing row as read. */
export type OidcSettings = typeof oidcSettings.$inferSelect;
/** The pairing row as written. */
export type NewOidcSettings = typeof oidcSettings.$inferInsert;
