import type { Express, Request, Response } from 'express';
import type { AuthHost } from '../auth/auth-host.ts';
import { type Auth, LOGIN_PATH, nonSessionCookies } from '../auth/better-auth.ts';
import { AUTH_BASE_PATH, appUrl, type ProviderConfig, type ProviderId, serverUrl } from '../core/config.ts';
import { HttpStatus } from '../core/wire.ts';

// The two legs of a provider's sign-in that cannot be GraphQL, because the browser has to be sent somewhere: out to
// the provider, and back from it. Both are better-auth's own endpoints (`signInSocial` and `/callback/:id`); this file
// only carries them over HTTP and changes how the session reaches the app.
//
// better-auth would end the callback by setting a session cookie. Ravocal keeps its session as a bearer token in the
// app instead, so the cookie is dropped and the browser lands on /auth/sso with a one-time token, which the app swaps
// for the session over GraphQL (`verifyOneTimeToken`). A link started from Settings ends here too, with no session.

/** Where the login page's buttons send the browser. */
export const SSO_START_PATH = '/sso/:provider';
/** Where a provider sends the browser back: better-auth's callback, at its default base path. */
export const SSO_CALLBACK_PATH = `${AUTH_BASE_PATH}/callback/:provider`;

/** The app's page that spends the one-time token. */
const SIGNED_IN_PATH = '/auth/sso';

/** What the login page is told when something here went wrong before better-auth could say what. */
export const SsoError = {
  SignInFailed: 'sign_in_failed',
  CallbackFailed: 'callback_failed',
  /** No such provider, or it is not set up on this instance (any more). */
  Off: 'sso_off',
} as const;
export type SsoError = (typeof SsoError)[keyof typeof SsoError];

/**
 * Names where the login page's button for a provider points.
 *
 * @param id - The provider.
 * @returns The start route, absolute, under `serverUrl()`.
 */
export function signInUrl(id: ProviderId): string {
  return `${serverUrl()}/sso/${id}`;
}

/**
 * Mounts the start and callback routes for every provider.
 *
 * @param app - The Express app. Mount before the static handler, whose fallback would answer both.
 * @param host - Where the current auth instance is. A provider it does not offer sends the browser back to the login
 *   page.
 */
export function mountSso(app: Express, host: AuthHost): void {
  app.get(SSO_START_PATH, (req, res) => {
    const provider = offered(host, req.params.provider);
    if (provider === undefined) {
      off(res);
      return;
    }
    start(host.current(), provider, req, res).catch((error: unknown) => fail(res, SsoError.SignInFailed, error));
  });
  app.get(SSO_CALLBACK_PATH, (req, res) => {
    if (offered(host, req.params.provider) === undefined) {
      off(res);
      return;
    }
    callback(host.current(), req, res).catch((error: unknown) => fail(res, SsoError.CallbackFailed, error));
  });
}

/**
 * Finds a provider the current instance offers.
 *
 * @param host - Where the current auth instance is.
 * @param id - The provider named in the path.
 * @returns The provider, or undefined when it is unknown or not set up.
 */
function offered(host: AuthHost, id: string): ProviderConfig | undefined {
  return host.providers().find((provider) => provider.id === id);
}

/**
 * Copies Express's headers into fetch `Headers`, which better-auth reads cookies from.
 *
 * @param raw - The request's headers as Express parsed them.
 * @returns The same headers, repeated ones appended.
 */
function toHeaders(raw: Request['headers']): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue;
    }
    for (const one of Array.isArray(value) ? value : [value]) {
      headers.append(name, one);
    }
  }
  return headers;
}

/**
 * Starts a sign-in. better-auth makes the state (with a signed cookie that ties it to this browser) and the PKCE
 * verifier, and says where the provider's authorize page is.
 *
 * @param auth - The current auth instance.
 * @param provider - The provider to sign in with.
 * @param req - The browser's request.
 * @param res - Answered with a redirect to the provider.
 */
async function start(auth: Auth, provider: ProviderConfig, req: Request, res: Response): Promise<void> {
  const { headers, response } = await auth.api.signInSocial({
    body: {
      provider: provider.id,
      callbackURL: `${appUrl()}${SIGNED_IN_PATH}`,
      // Which provider refused, so the login page can name it.
      errorCallbackURL: `${appUrl()}${LOGIN_PATH}?provider=${provider.id}`,
      disableRedirect: true,
    },
    headers: toHeaders(req.headers),
    returnHeaders: true,
  });
  const url = response && 'url' in response ? response.url : undefined;
  if (!url) {
    throw new Error('better-auth returned no authorize URL');
  }
  for (const cookie of headers?.getSetCookie() ?? []) {
    res.append('set-cookie', cookie);
  }
  res.redirect(HttpStatus.Found, url);
}

/**
 * The provider's redirect back. better-auth checks the state, swaps the code, verifies the id token and either opens a
 * session or links the provider to the reader who asked; this swaps the session cookie it would have set for a
 * one-time token on the app's URL.
 *
 * @param auth - The current auth instance.
 * @param req - The provider's redirect, as the browser followed it.
 * @param res - Answered with a redirect to the app.
 */
async function callback(auth: Auth, req: Request, res: Response): Promise<void> {
  const request = new Request(new URL(req.originalUrl, serverUrl()), {
    method: 'GET',
    headers: toHeaders(req.headers),
  });
  const response = await auth.handler(request);

  // The state cookie's expiry, and anything else that is not the session.
  for (const cookie of await nonSessionCookies(auth, response.headers)) {
    res.append('set-cookie', cookie);
  }

  const location = response.headers.get('location');
  if (!location) {
    fail(
      res,
      SsoError.CallbackFailed,
      new Error(`better-auth's callback answered ${response.status} with no redirect`),
    );
    return;
  }

  // The bearer plugin sets this whenever a session cookie is: the new session.
  const session = response.headers.get('set-auth-token');
  if (!session) {
    // A refusal, on its way to the login page with better-auth's code, or a finished link on its way to Settings.
    res.redirect(HttpStatus.Found, location);
    return;
  }
  // The token is a session for whoever holds it, so it goes nowhere but the app.
  const target = appRedirect(location);
  if (target === null) {
    fail(res, SsoError.CallbackFailed, new Error(`better-auth's callback pointed off the app's origin: ${location}`));
    return;
  }
  const { token } = await auth.api.generateOneTimeToken({
    headers: new Headers({ authorization: `Bearer ${session}` }),
  });
  target.searchParams.set('token', token);
  res.redirect(HttpStatus.Found, target.toString());
}

/**
 * Reads where better-auth's callback sends a finished sign-in, if that is the app.
 *
 * @param location - Its `location` header: a path on the app, or an absolute URL.
 * @returns The URL, resolved against `appUrl()`, or null when it is not on the app's origin.
 */
export function appRedirect(location: string): URL | null {
  const { origin } = new URL(appUrl());
  const target = URL.parse(location, origin);
  return target !== null && target.origin === origin ? target : null;
}

/**
 * Sends the browser back to the login page, which says that provider cannot be signed in with here.
 *
 * @param res - Answered with the redirect.
 */
function off(res: Response): void {
  res.redirect(HttpStatus.Found, `${appUrl()}${LOGIN_PATH}?error=${SsoError.Off}`);
}

/**
 * Logs a failure and sends the browser back to the login page, which says that signing in failed.
 *
 * @param res - Answered with the redirect, unless something was already sent.
 * @param code - What the login page is told.
 * @param error - What went wrong, for the log.
 */
function fail(res: Response, code: SsoError, error: unknown): void {
  console.error(`[auth] provider sign-in ${code}:`, error);
  if (res.headersSent) {
    return;
  }
  res.redirect(HttpStatus.Found, `${appUrl()}${LOGIN_PATH}?error=${code}`);
}
