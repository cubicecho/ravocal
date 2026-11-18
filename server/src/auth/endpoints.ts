import {
  applyBetterAuthGraphQL,
  betterAuthGraphQL,
  type JsonSchema,
  type OperationCall,
  type OperationOptions,
} from '@cubicecho/graphql-better-auth';
import type { DB } from '@cubicecho/ravocal-db';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import { z } from 'zod';
import { appUrl, secureLocalNet } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { createAuth, nonSessionCookies, sendsMagicLinks, sessionUserId } from './better-auth.ts';
import { AuthFlow, throttle } from './throttle.ts';

// better-auth's own endpoints, served as GraphQL by @cubicecho/graphql-better-auth. Fields, arguments and types are
// read off the auth instance, so a better-auth upgrade moves them with it. What Ravocal adds is in the `around`s:
// the throttle, SECURE_LOCAL_NET, the rule on the last way to sign in, and errors that never sign anyone out.

/** The better-auth endpoints served, by name. Nothing else better-auth offers is reachable. */
export const BETTER_AUTH_OPERATIONS = [
  'signInMagicLink',
  'magicLinkVerify',
  'verifyOneTimeToken',
  'getSession',
  'listSessions',
  'signOut',
  'revokeSession',
  'revokeSessions',
  'revokeOtherSessions',
  'linkSocialAccount',
  'listUserAccounts',
  'unlinkAccount',
];

/** How an account made by a SECURE_LOCAL_NET sign-in is labelled in better-auth's hooks. */
const LOCAL_NET_METHOD = 'secure-local-net';

/** The app's Settings page, where connecting a provider starts and ends. */
const SETTINGS_PATH = '/settings';

/** What a link that cannot be spent is told, whichever way it is wrong. */
const BAD_LINK = 'Invalid or expired sign-in link.';

/** What a one-time token that cannot be spent is told: the sign-in has to be started again. */
const BAD_SSO_TOKEN = 'Invalid or expired sign-in. Sign in again.';

/** What unlinking the last way to sign in is told. */
const LAST_WAY =
  'This is the only way you can sign in. Sign in with an email link once, so Ravocal knows the address is yours, then disconnect it.';

/** better-auth's code for a session too old to change how its account signs in (`session.freshAge`, a day). */
const SESSION_NOT_FRESH = 'SESSION_NOT_FRESH';

/** What disconnecting with such a session is told. */
const SIGN_IN_AGAIN = 'For your safety, sign out and in again before disconnecting an account.';

/** A session as the client keeps it: the bearer token, and whose it is. */
const SESSION_RESULT: JsonSchema = {
  type: 'object',
  properties: {
    token: { type: 'string', description: 'The session, to send as `Authorization: Bearer <token>`.' },
    userId: { type: 'string', format: 'uuid', description: "The session's user." },
  },
  required: ['token', 'userId'],
};

/** Where to send the browser to connect a provider. */
const LINK_RESULT: JsonSchema = {
  type: 'object',
  properties: { url: { type: 'string', description: "The provider's authorize page. Open it in this browser." } },
  required: ['url'],
};

/** What each call's endpoint answered with, for an `around` that needs its headers after `next()`. */
const responseHeaders = new WeakMap<OperationCall<Context>, Headers>();

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
 * Spends the one-time token a provider's callback put on `/auth/sso` for the session it stands for. Expired, spent and
 * unknown tokens answer the same.
 */
const verifyOneTimeToken: OperationOptions<Context> = {
  result: () => SESSION_RESULT,
  around: async (call, next) => {
    // By IP alone: until the token verifies there is no address to count against.
    throttle(call.context, AuthFlow.VerifyOneTimeToken);
    const result = (await refusedAs(next, BAD_SSO_TOKEN)) as { session: { token: string }; user: { id: string } };
    return { token: result.session.token, userId: result.user.id };
  },
};

/**
 * Starts connecting a provider to the signed-in reader. The answer is the provider's authorize page; the state cookie
 * that ties the flow to this browser goes on the response, and the provider sends the browser back to Settings.
 */
const linkSocialAccount: OperationOptions<Context> = {
  omitArgs: [
    'callbackURL',
    'errorCallbackURL',
    'disableRedirect',
    'idToken',
    'requestSignUp',
    'scopes',
    'loginHint',
    'additionalParams',
    'additionalData',
  ],
  result: () => LINK_RESULT,
  around: async (call, next) => {
    requireAuth(call.context);
    const provider = String(call.body.provider);
    const isOffered = call.context.authHost.providers().some((offered) => offered.id === provider);
    if (isOffered === false) {
      throw badInput(`Signing in with ${provider} is not set up on this instance.`);
    }
    call.body.callbackURL = `${appUrl()}${SETTINGS_PATH}?connected=${provider}`;
    call.body.errorCallbackURL = `${appUrl()}${SETTINGS_PATH}?provider=${provider}`;
    call.body.disableRedirect = true;
    const { url } = (await next()) as { url: string };
    const headers = responseHeaders.get(call);
    for (const cookie of headers === undefined ? [] : await nonSessionCookies(call.context.auth, headers)) {
      call.context.setCookie(cookie);
    }
    return { url };
  },
};

/**
 * Whether the reader could still sign in by email: anyone can under SECURE_LOCAL_NET, and otherwise an address a link
 * has confirmed can, while the instance sends links.
 *
 * @param context - The request's context.
 * @param emailVerified - Whether the reader's address has been confirmed.
 * @returns true when the email way to sign in works for them.
 */
function emailSignsIn(context: Context, emailVerified: boolean): boolean {
  return secureLocalNet() || (emailVerified && sendsMagicLinks(context.auth));
}

/**
 * Disconnects a provider from the signed-in reader, unless it is their last way to sign in: no other provider this
 * instance offers is connected, and no email link would reach them.
 */
const unlinkAccount: OperationOptions<Context> = {
  around: async (call, next) => {
    const userId = requireAuth(call.context);
    const { internalAdapter } = await call.context.auth.$context;
    const [user, accounts] = await Promise.all([
      internalAdapter.findUserById(userId),
      internalAdapter.findAccounts(userId),
    ]);
    const target = accounts.find((account) => account.id === call.body.accountId);
    if (target === undefined) {
      throw notFound('That account is not connected.');
    }
    const offered = new Set<string>(call.context.authHost.providers().map((provider) => provider.id));
    const otherWays = accounts.filter((account) => account.id !== target.id && offered.has(account.providerId));
    const isLastWay =
      offered.has(target.providerId) &&
      otherWays.length === 0 &&
      emailSignsIn(call.context, user?.emailVerified === true) === false;
    if (isLastWay) {
      throw badInput(LAST_WAY);
    }
    try {
      return await next();
    } catch (error) {
      const isStale = error instanceof GraphQLError && error.extensions.authCode === SESSION_NOT_FRESH;
      throw isStale ? badInput(SIGN_IN_AGAIN) : error;
    }
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
  // Described from an instance that always has the magic-link plugin, so the fields don't depend on SMTP_URL, and no
  // provider, so describing it fetches nothing. Linking a provider is better-auth's core, there with or without one.
  const describing = createAuth(db, { sendMagicLink: async () => {}, providers: [] });
  const built = betterAuthGraphQL<Context>(describing, {
    include: BETTER_AUTH_OPERATIONS,
    auth: (context) => context.auth,
    headers: (context) => context.headers,
    onResponseHeaders: (headers, call) => {
      responseHeaders.set(call, headers);
    },
    operations: { signInMagicLink, magicLinkVerify, verifyOneTimeToken, signOut, linkSocialAccount, unlinkAccount },
  });
  return applyBetterAuthGraphQL(schema, built);
}
