import type { DB } from '@cubicecho/ravocal-db';
import {
  isProduction,
  isPublicHttp,
  normalizeIssuer,
  OIDC_CLIENT_AUTH_METHODS,
  ProviderId,
  providerRedirectUri,
} from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { HttpStatus } from '../core/wire.ts';
import { clearPairedOidc, type PairedOidc, readPairedOidc, savePairedOidc } from './settings.ts';

// Pairing with an OIDC provider by pasting one URL, instead of copying a client id and secret into the environment.
// The provider (heautou, or any other that does OAuth 2.0 Dynamic Client Registration) hands its admin a setup URL:
//
//   <issuer>#setup=<initial access token>&name=<what to call it>
//
// Ravocal reads the issuer's discovery document, registers itself at its registration endpoint with the token
// (RFC 7591), and keeps the client it gets back. Unpairing deletes the client at the provider (RFC 7592).
//
// The token is a credential. It rides in the URL's fragment, so it never reaches a server log on the way here; it is
// sent once, to the registration endpoint of the issuer it came with, and never logged or stored.

/** Why pairing failed, for the app to say what to do next. Sent as `extensions.reason`. */
export const PairingFailure = {
  /** The text is not a setup URL. */
  BadUrl: 'BAD_URL',
  /** Nothing at the URL answers as an OIDC provider, it names another issuer, or it answered nonsense. */
  NotAProvider: 'NOT_A_PROVIDER',
  /** The provider has no registration endpoint. */
  NoRegistration: 'NO_REGISTRATION',
  /** The setup URL has expired, was used already, or was cancelled. */
  Expired: 'EXPIRED',
  /** The provider would not register Ravocal as described. */
  Refused: 'REFUSED',
  /** The provider is turning requests away for now. */
  RateLimited: 'RATE_LIMITED',
} as const;
export type PairingFailure = (typeof PairingFailure)[keyof typeof PairingFailure];

/** A pairing that did not happen, and why. Its message is a sentence an admin can act on, and never has the token. */
export class PairingError extends Error {
  readonly reason: PairingFailure;

  constructor(reason: PairingFailure, message: string) {
    super(message);
    this.name = 'PairingError';
    this.reason = reason;
  }
}

/** A setup URL, taken apart. */
export interface SetupUrl {
  issuer: string;
  /** The initial access token. A credential: never logged or stored. */
  token: string;
  name: string;
}

/** What Ravocal asks the provider to call it. */
const CLIENT_NAME = 'Ravocal';

/** The OAuth error a provider answers a token it does not accept with (RFC 6750). */
const INVALID_TOKEN = 'invalid_token';

/** The schemes a setup URL may have. */
const WEB_PROTOCOLS = new Set(['https:', 'http:']);

/** The lowest status a redirect answers with (RFC 9110, section 15.4). */
const FIRST_REDIRECT_STATUS = 300;
/** The highest. */
const LAST_REDIRECT_STATUS = 399;

/**
 * Takes a setup URL apart.
 *
 * @param text - What was pasted.
 * @returns The issuer (the URL without its fragment, query or trailing slash), the initial access token, and the
 *   provider's name (`AUTH_DEFAULTS.oidcName` when it gives none).
 * @throws A `PairingError` (BAD_URL) when it is not a setup URL, or in production when it is `http:` on a public host:
 *   the setup token, and later the client secret, would cross the network in the clear.
 */
export function parseSetupUrl(text: string): SetupUrl {
  const url = URL.parse(text.trim());
  if (url === null) {
    throw new PairingError(PairingFailure.BadUrl, 'That is not a URL. Paste the setup URL your provider gave you.');
  }
  if (WEB_PROTOCOLS.has(url.protocol) === false) {
    throw new PairingError(
      PairingFailure.BadUrl,
      'A setup URL starts with https://. Paste the one your provider gave you.',
    );
  }
  const isCleartext = isProduction() && isPublicHttp(url.toString());
  if (isCleartext) {
    throw new PairingError(
      PairingFailure.BadUrl,
      "This setup URL is http:// on a public address, so its token would cross the network in the clear. Ask your provider's admin for its https:// address.",
    );
  }
  const params = new URLSearchParams(url.hash.slice(1));
  const token = params.get('setup');
  if (!token) {
    throw new PairingError(
      PairingFailure.BadUrl,
      'That URL has no setup token. Copy the whole setup URL from your provider, including the part after #.',
    );
  }
  url.hash = '';
  url.search = '';
  return {
    issuer: normalizeIssuer(url.toString()),
    token,
    name: params.get('name')?.trim() || AUTH_DEFAULTS.oidcName,
  };
}

/**
 * Makes one request to the provider, with the pairing timeout. Every call pairing makes goes through here.
 *
 * @remarks
 * A redirect is not followed: the setup token and the registration access token go only to the endpoint the issuer's
 * own document names, never wherever that endpoint points on.
 *
 * @param url - Where.
 * @param [init] - The request.
 * @returns The response, whatever its status but a redirect.
 * @throws A `PairingError` (NOT_A_PROVIDER) when nothing answered in time, or the answer was a redirect.
 */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const { origin } = new URL(url);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_DEFAULTS.oidcPairingTimeoutMs),
    });
  } catch {
    throw new PairingError(PairingFailure.NotAProvider, `Could not reach ${origin}. Check the setup URL.`);
  }
  const isRedirect = response.status >= FIRST_REDIRECT_STATUS && response.status <= LAST_REDIRECT_STATUS;
  if (isRedirect) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `${origin} answered with a redirect, which pairing does not follow. Check the setup URL with your provider's admin.`,
    );
  }
  return response;
}

/**
 * Reads a JSON response's body as an object.
 *
 * @param response - The response.
 * @returns Its fields, or an empty object when it has none or is not JSON.
 */
async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body)) : {};
  } catch {
    return {};
  }
}

/**
 * Reads a field that should be text.
 *
 * @param value - The field.
 * @returns The text, or null when it is missing, empty or not a string.
 */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Reads the issuer's registration endpoint, once its discovery document has been checked as the issuer's own.
 *
 * @param issuer - The issuer the setup URL names.
 * @returns The registration endpoint.
 * @throws A `PairingError` when the document is missing, another issuer's, or names no registration endpoint.
 */
async function discoverRegistration(issuer: string): Promise<string> {
  const response = await call(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
  });
  const doc = response.ok ? await json(response) : {};
  // Checked before the token goes anywhere: a document naming another issuer would have it sent wherever it says.
  const claimed = text(doc.issuer);
  if (claimed === null || normalizeIssuer(claimed) !== issuer) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `${issuer} is not an OpenID Connect provider. Check the setup URL.`,
    );
  }
  const endpoint = text(doc.registration_endpoint);
  if (endpoint === null) {
    throw new PairingError(
      PairingFailure.NoRegistration,
      'This provider does not support pairing. Register Ravocal with it by hand, and set OIDC_ISSUER and OIDC_CLIENT_ID in the server environment instead.',
    );
  }
  return endpoint;
}

/**
 * Says what Ravocal asks to be registered as.
 *
 * @returns The client metadata (RFC 7591).
 */
function clientMetadata() {
  return {
    client_name: CLIENT_NAME,
    redirect_uris: [providerRedirectUri(ProviderId.Oidc)],
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  };
}

/**
 * Turns a refused registration into what to tell the admin.
 *
 * @param response - The registration endpoint's answer, not 2xx.
 * @returns The failure.
 */
async function refusal(response: Response): Promise<PairingError> {
  const body = await json(response);
  if (response.status === HttpStatus.Unauthorized || body.error === INVALID_TOKEN) {
    return new PairingError(
      PairingFailure.Expired,
      'This setup URL has expired, was used already, or was cancelled. Ask your provider for a new one.',
    );
  }
  if (response.status === HttpStatus.TooManyRequests) {
    return new PairingError(
      PairingFailure.RateLimited,
      'The provider is turning requests away for now. Try again in a minute.',
    );
  }
  if (response.status === HttpStatus.BadRequest) {
    const description = text(body.error_description) ?? text(body.error) ?? 'it gave no reason';
    return new PairingError(PairingFailure.Refused, `The provider would not register ${CLIENT_NAME}: ${description}.`);
  }
  return new PairingError(
    PairingFailure.NotAProvider,
    `The provider answered ${response.status} when asked to register ${CLIENT_NAME}. Check the setup URL, or try again later.`,
  );
}

/**
 * Registers Ravocal with the provider a setup URL names, and keeps the client.
 *
 * @param db - The database.
 * @param setupUrl - What the admin pasted.
 * @returns The pairing as saved. The caller rebuilds the auth instance (auth/auth-host.ts) to offer it.
 * @throws A `PairingError` saying why, when nothing was paired. Nothing is saved then.
 */
export async function pair(db: DB, setupUrl: string): Promise<PairedOidc> {
  const setup = parseSetupUrl(setupUrl);
  const endpoint = await discoverRegistration(setup.issuer);
  const response = await call(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${setup.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(clientMetadata()),
  });
  if (response.ok === false) {
    throw await refusal(response);
  }
  const body = await json(response);
  const clientId = text(body.client_id);
  if (clientId === null) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `The provider registered ${CLIENT_NAME} but sent back no client id. Ask its admin to check the registration.`,
    );
  }
  const clientSecret = text(body.client_secret);
  const paired: PairedOidc = {
    issuer: setup.issuer,
    clientId,
    clientSecret,
    // The provider may have registered another method than the one asked for: its answer is what it will expect.
    clientAuth:
      OIDC_CLIENT_AUTH_METHODS.find((method) => method === body.token_endpoint_auth_method) ??
      AUTH_DEFAULTS.oidcClientAuth,
    name: setup.name,
    registrationAccessToken: text(body.registration_access_token),
    registrationClientUri: text(body.registration_client_uri),
  };
  await savePairedOidc(db, paired);
  return paired;
}

/**
 * Deletes Ravocal's client at the provider (RFC 7592) and forgets the pairing.
 *
 * @remarks
 * The pairing is forgotten whatever the provider answers, so an admin is never stuck with a provider they want gone;
 * when it could not confirm, the provider's admin can remove the client on their side, and a warning says so.
 *
 * @param db - The database.
 * @returns Whether the provider confirmed the client is gone. True with no pairing: there is nothing to delete.
 */
export async function unpair(db: DB): Promise<boolean> {
  const paired = await readPairedOidc(db);
  if (paired === null) {
    return true;
  }
  const removed = await deleteClient(paired);
  await clearPairedOidc(db);
  if (removed === false) {
    console.warn(
      `[auth] forgot the pairing with ${paired.issuer}, but could not confirm its client ${paired.clientId} was deleted there. Ask the provider's admin to remove it.`,
    );
  }
  return removed;
}

/**
 * Asks the provider to delete the client.
 *
 * @param paired - The pairing, with what deletes its client.
 * @returns Whether the provider confirmed it is gone: a 2xx, or a 401 or 404 for a client already gone. False with no
 *   way to ask, or no answer.
 */
async function deleteClient(paired: PairedOidc): Promise<boolean> {
  const { registrationClientUri: uri, registrationAccessToken: token } = paired;
  if (uri === null || token === null) {
    return false;
  }
  try {
    const response = await call(uri, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    const isGone =
      response.ok || response.status === HttpStatus.Unauthorized || response.status === HttpStatus.NotFound;
    if (isGone === false) {
      console.warn(`[auth] the OIDC provider answered ${response.status} to deleting client ${paired.clientId}`);
    }
    return isGone;
  } catch (error) {
    console.warn(
      `[auth] could not reach the OIDC provider to delete client ${paired.clientId}: ${errorMessage(error)}`,
    );
    return false;
  }
}
