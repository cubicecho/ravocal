import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { secureLocalNet } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { sendsMagicLinks } from './better-auth.ts';

const AUTH_SDL = parse(`
  "Which ways of signing in this instance offers, so the sign-in page shows only those."
  type AuthConfig {
    "Any email address signs in at once, with no link. Private networks only."
    secureLocalNet: Boolean!
    "The instance can email sign-in links."
    magicLink: Boolean!
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
  });
  return extended;
}
