import { applyBetterAuthGraphQL, betterAuthGraphQL, type OperationOptions } from '@cubicecho/graphql-better-auth';
import type { DB } from '@cubicecho/ravocal-db';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import { z } from 'zod';
import { secureLocalNet } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { createAuth, sendsMagicLinks, sessionUserId } from './better-auth.ts';
import { AuthFlow, throttle } from './throttle.ts';

// better-auth's own endpoints, served as GraphQL by @cubicecho/graphql-better-auth. Fields, arguments and types are
// read off the auth instance, so a better-auth upgrade moves them with it. What Ravocal adds is in the `around`s:
// the throttle, SECURE_LOCAL_NET, and errors that never sign anyone out.

/** The better-auth endpoints served, by name. Nothing else better-auth offers is reachable. */
export const BETTER_AUTH_OPERATIONS = [
  'signInMagicLink',
  'magicLinkVerify',
  'getSession',
  'listSessions',
  'signOut',
  'revokeSession',
  'revokeSessions',
  'revokeOtherSessions',
];

/** How an account made by a SECURE_LOCAL_NET sign-in is labelled in better-auth's hooks. */
const LOCAL_NET_METHOD = 'secure-local-net';

/** What a link that cannot be spent is told, whichever way it is wrong. */
const BAD_LINK = 'Invalid or expired sign-in link.';

/** What an instance with no way to deliver a link answers a request for one. */
const NO_LINKS =
  'This instance cannot email sign-in links. Whoever runs it needs to set SMTP_URL, or SECURE_LOCAL_NET on a private network.';

const emailInput = z.email('Enter a valid email address.');

/**
 * What a new account is called until its owner says otherwise.
 *
 * @param email - The account's address, already normalized.
 * @returns The part of the address before the `@`.
 */
function nameFor(email: string): string {
  return email.split('@')[0] ?? email;
}

/**
 * Runs a token-spending call, and answers any refusal from better-auth with one message.
 *
 * BAD_USER_INPUT, never the UNAUTHENTICATED better-auth's 401 maps to: that one is what the client drops its session
 * on, and a bad link must not sign anyone out. What is not a refusal (the database failing) is rethrown as it is.
 *
 * @param next - The call.
 * @param message - What the caller is told when the token is refused.
 * @returns What the call returned.
 */
async function refusedAs(next: () => Promise<unknown>, message: string): Promise<unknown> {
  try {
    return await next();
  } catch (error) {
    throw error instanceof GraphQLError ? badInput(message) : error;
  }
}

/**
 * Signs an address in on the strength of the network alone, creating the account when there is none.
 *
 * @param context - The request context.
 * @param email - The address, already normalized.
 * @returns The session's bearer token and user.
 */
async function signInOnLocalNet(context: Context, email: string): Promise<{ token: string; userId: string }> {
  const { internalAdapter } = await context.auth.$context;
  const existing = await internalAdapter.findUserByEmail(email);
  // Unverified, so a later link verifies this same row and the account stays one user.
  const user =
    existing?.user ??
    (await internalAdapter.createUser(
      { email, name: nameFor(email), emailVerified: false },
      { method: LOCAL_NET_METHOD },
    ));
  const session = await internalAdapter.createSession(user.id);
  return { token: session.token, userId: user.id };
}

/**
 * Sign-in. Takes only an address: the link always goes to the app's verify page. Under SECURE_LOCAL_NET no link is
 * sent and the session comes back in `token` and `userId`.
 */
const signInMagicLink: OperationOptions<Context> = {
  omitArgs: ['name', 'metadata', 'callbackURL', 'newUserCallbackURL', 'errorCallbackURL'],
  result: (documented) => ({
    ...documented,
    type: 'object',
    properties: {
      ...documented?.properties,
      token: { type: ['string', 'null'], description: 'A live session, under SECURE_LOCAL_NET.' },
      userId: { type: ['string', 'null'], format: 'uuid', description: "The session's user, under SECURE_LOCAL_NET." },
    },
  }),
  around: async (call, next) => {
    const normalized = String(call.body.email).toLowerCase().trim();
    throttle(call.context, AuthFlow.SignInMagicLink, normalized);
    const email = parseOrThrow(emailInput, normalized);
    // The network is the credential, so the address alone opens the account.
    if (secureLocalNet()) {
      return { status: true, ...(await signInOnLocalNet(call.context, email)) };
    }
    if (sendsMagicLinks(call.context.auth) === false) {
      throw badInput(NO_LINKS);
    }
    call.body.email = email;
    call.body.name = nameFor(email);
    // A link went out, so there is no session yet.
    return Object.assign({}, await next(), { token: null, userId: null });
  },
};

/** Spends a sign-in link's token for a session. Expired, used and unknown tokens answer the same. */
const magicLinkVerify: OperationOptions<Context> = {
  omitArgs: ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'],
  around: (call, next) => {
    // By IP alone: until the token verifies there is no address to count against.
    throttle(call.context, AuthFlow.MagicLinkVerify);
    if (sendsMagicLinks(call.context.auth) === false) {
      throw badInput(BAD_LINK);
    }
    return refusedAs(next, BAD_LINK);
  },
};

/** Ends the caller's session. Signing out with none is `success: false`, not an error. */
const signOut: OperationOptions<Context> = {
  omitArgs: ['callbackURL', 'disableRedirect', 'state'],
  around: async (call, next) => {
    if ((await sessionUserId(call.context.auth, call.context.headers)) === null) {
      return { success: false };
    }
    return next();
  },
};

/**
 * Adds better-auth's endpoints to the schema. Each call goes to the request's own auth instance with the request's
 * headers, which is where better-auth finds the session.
 *
 * @param schema - The schema so far.
 * @param db - The database the describing instance is built over. It is never queried.
 * @returns The schema with them.
 */
export function applyBetterAuthExtension(schema: GraphQLSchema, db: DB): GraphQLSchema {
  // Described from an instance that always has the magic-link plugin, so the fields don't depend on SMTP_URL.
  const describing = createAuth(db, { sendMagicLink: async () => {} });
  const built = betterAuthGraphQL<Context>(describing, {
    include: BETTER_AUTH_OPERATIONS,
    auth: (context) => context.auth,
    headers: (context) => context.headers,
    operations: { signInMagicLink, magicLinkVerify, signOut },
  });
  return applyBetterAuthGraphQL(schema, built);
}
