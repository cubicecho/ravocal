import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { secureLocalNet } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { signInUrl } from '../http/sso.ts';
import { sendsMagicLinks } from './better-auth.ts';

const AUTH_SDL = parse(`
  "A provider a reader can sign in with instead of an email link."
  type AuthProvider {
    "The provider's id: google, facebook or oidc (the instance's own OIDC provider). The end of its callback path."
    id: String!
    "What the button calls it: Google, or the OIDC provider's name."
    name: String!
    "Where the button sends the browser, absolute. A page to open, not a request to make."
    signInUrl: String!
  }

  "Which ways of signing in this instance offers, so the sign-in page shows only those."
  type AuthConfig {
    "Any email address signs in at once, with no link. Private networks only."
    secureLocalNet: Boolean!
    "The instance can email sign-in links."
    magicLink: Boolean!
    "The providers set up on this instance, in the order the sign-in page lists them. Empty with none."
    providers: [AuthProvider!]!
  }

  extend type Query {
    authConfig: AuthConfig!
  }
`);

/**
 * Adds `authConfig` to the schema. Signing in and out are better-auth's own endpoints (endpoints.ts).
 *
 * @param schema - The schema so far.
 * @returns The schema with `authConfig` on it.
 */
export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, AUTH_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  queries.authConfig.resolve = (_parent: unknown, _args: unknown, context: Context) => ({
    secureLocalNet: secureLocalNet(),
    magicLink: sendsMagicLinks(context.auth),
    providers: context.authHost
      .providers()
      .map((provider) => ({ id: provider.id, name: provider.name, signInUrl: signInUrl(provider.id) })),
  });
  return extended;
}
