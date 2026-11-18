import { assertObjectType, extendSchema, GraphQLError, type GraphQLSchema, parse } from 'graphql';
import { hasUsers, isAdmin } from '../auth/admin.ts';
import { AuthFlow, throttle } from '../auth/throttle.ts';
import { ProviderId, providerRedirectUri } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput, conflict, ErrorCode, forbidden } from '../core/errors.ts';
import { PairingError, PairingFailure, pair, unpair } from './pairing.ts';
import { effectiveOidc, SsoSource } from './settings.ts';

// Pairing the instance with an OIDC provider from the app (pairing.ts): paste the setup URL the provider gave you, and
// its button appears on the login page without a restart.
//
// Who may pair: the admin, or anyone at all while the instance is brand new (no accounts yet), so whoever installs
// Ravocal can set sign-in up from the login page before there is an admin to ask. The first account to be created
// becomes the admin (auth/admin.ts). Once anyone has an account, a stranger could otherwise point sign-in at a provider
// of their own that vouches for any address, and sign in as an existing account, so only the admin may.
//
// A provider set in the environment (OIDC_ISSUER) wins, and cannot be changed from here.

const SSO_SDL = parse(`
  "Where the instance's OIDC provider comes from."
  enum SsoSource {
    "OIDC_ISSUER and OIDC_CLIENT_ID in the server's environment. Read-only from the app."
    ENV
    "Paired from a setup URL."
    PAIRED
    "There is none."
    NONE
  }

  "How sign-in through the instance's OIDC provider is set up, and whether the caller may change it."
  type SsoSetup {
    source: SsoSource!
    "The provider's issuer URL. Only for a caller who may pair; null otherwise, and with no provider."
    issuer: String
    "What the login page's button calls the provider. Null with no provider."
    name: String
    "Whether the caller may pair a provider, or disconnect the paired one."
    canPair: Boolean!
    "The redirect URI to register with a provider by hand, for an OIDC_ISSUER setup."
    redirectUri: String!
  }

  extend type Query {
    "Readable signed out, so a new instance's login page can offer to set sign-in up."
    ssoSetup: SsoSetup!
  }

  extend type Mutation {
    """
    Pairs with the provider a setup URL names (\`<issuer>#setup=<token>&name=<name>\`). The admin, or anyone while
    the instance has no accounts. BAD_USER_INPUT or TOO_MANY_REQUESTS with \`extensions.reason\` when the provider
    would not pair; CONFLICT when a provider is paired already; TOO_MANY_REQUESTS without a reason past the sign-in
    budget for the caller's address.
    """
    pairSso(setupUrl: String!): SsoSetup!
    "Deletes the paired provider's client and stops offering it on the login page. Same rule as pairSso."
    unpairSso: SsoSetup!
  }
`);

/**
 * Whether the caller may pair or disconnect a provider.
 *
 * @param ctx - The request.
 * @param source - Where the provider in use comes from.
 * @returns False for a provider from the environment; otherwise true for the admin, or for anyone while there are no
 *   accounts.
 */
export async function canPairSso(ctx: Context, source: SsoSource): Promise<boolean> {
  if (source === SsoSource.Env) {
    return false;
  }
  if (ctx.userId !== null && (await isAdmin(ctx.db, ctx.userId))) {
    return true;
  }
  return (await hasUsers(ctx.db)) === false;
}

/**
 * Answers `ssoSetup` for the caller.
 *
 * @param ctx - The request.
 * @returns How sign-in is set up, with the issuer only for a caller who may pair.
 */
async function ssoSetup(ctx: Context) {
  const { config, source } = await effectiveOidc(ctx.db);
  const canPair = await canPairSso(ctx, source);
  return {
    source,
    issuer: canPair ? (config?.issuer ?? null) : null,
    name: config?.name ?? null,
    canPair,
    redirectUri: providerRedirectUri(ProviderId.Oidc),
  };
}

/**
 * Refuses a caller who may not pair.
 *
 * @param ctx - The request.
 * @returns Where the provider in use comes from.
 * @throws FORBIDDEN, saying where it can be changed instead. This is about the instance, not a row, so it is not the
 *   NOT_FOUND a row out of reach would be.
 */
async function requirePairing(ctx: Context): Promise<SsoSource> {
  const { source } = await effectiveOidc(ctx.db);
  if (source === SsoSource.Env) {
    throw forbidden("Sign-in is set by OIDC_ISSUER in the server's environment. Change it there.");
  }
  if ((await canPairSso(ctx, source)) === false) {
    throw forbidden('Only the admin can change how people sign in.');
  }
  return source;
}

/**
 * Turns a pairing failure into an API error that carries its reason for the app.
 *
 * @param error - What pairing threw.
 * @returns The API error, or `error` itself when it is not a pairing failure.
 */
function pairingError(error: unknown): unknown {
  if (error instanceof PairingError === false) {
    return error;
  }
  const code = error.reason === PairingFailure.RateLimited ? ErrorCode.TooManyRequests : ErrorCode.BadUserInput;
  return new GraphQLError(error.message, { extensions: { code, reason: error.reason } });
}

/**
 * Adds `ssoSetup`, `pairSso` and `unpairSso` to the schema.
 *
 * @param schema - The schema, which must already have a Mutation type.
 * @returns The extended schema.
 */
export function applySsoExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, SSO_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  queries.ssoSetup.resolve = (_parent: unknown, _args: unknown, context: Context) => ssoSetup(context);

  mutations.pairSso.resolve = async (_parent: unknown, args: { setupUrl: string }, context: Context) => {
    // First, so a refused attempt reaches neither the database nor the provider.
    throttle(context, AuthFlow.PairSso);
    const source = await requirePairing(context);
    if (source === SsoSource.Paired) {
      throw conflict('Ravocal is already paired with a provider. Disconnect it first.');
    }
    if (args.setupUrl.trim() === '') {
      throw badInput('Paste the setup URL your provider gave you.');
    }
    try {
      await pair(context.db, args.setupUrl);
    } catch (error) {
      throw pairingError(error);
    }
    // So the login page offers it at once, without a restart.
    await context.authHost.rebuild();
    return ssoSetup(context);
  };

  mutations.unpairSso.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    throttle(context, AuthFlow.UnpairSso);
    await requirePairing(context);
    await unpair(context.db);
    await context.authHost.rebuild();
    return ssoSetup(context);
  };

  return extended;
}
