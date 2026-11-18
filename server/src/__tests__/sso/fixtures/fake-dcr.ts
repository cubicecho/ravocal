import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { portOf } from '../../helpers.ts';
import {
  mountOidcIssuer,
  type OidcClient,
  type OidcIssuer,
  type OidcProfile,
} from '../../http/fixtures/oidc-issuer.ts';

// A stand-in for a provider that does OAuth 2.0 Dynamic Client Registration (heautou, or any other), on a loopback
// port: a discovery document naming a registration endpoint, registration on an initial access token (RFC 7591),
// deleting the client on its registration access token (RFC 7592), and, once a client is registered, the same OpenID
// Connect sign-in as the Google stand-in (http/fixtures/oidc-issuer.ts).

/** The initial access token the provider hands out in its setup URL. */
export const SETUP_TOKEN = 'iat-good-0123456789';
/** The client it registers. */
export const REGISTERED: Readonly<OidcClient> = Object.freeze({
  clientId: 'ravocal-paired',
  clientSecret: 'paired-secret-0123456789',
});
/** The credential that deletes that client. */
export const REGISTRATION_TOKEN = 'rat-0123456789';

/** What registration answers next, when the token is good. `redirect` sends the request on to another endpoint. */
export type RegistrationAnswer = 'created' | 'badRedirect' | 'rateLimited' | 'redirect';

/** What the provider says to a redirect URI it will not take. */
export const BAD_REDIRECT_DESCRIPTION = 'redirect_uris must use https';

/** One call to the registration endpoint. */
export interface Registration {
  body: Record<string, unknown>;
  authorization: string | undefined;
}

export interface FakeDcr {
  /** The issuer, and so the start of a setup URL. */
  issuer: string;
  /** What discovery says the issuer is. Set it to another to forge the document. */
  claimedIssuer: string;
  /** Whether discovery names a registration endpoint. */
  canRegister: boolean;
  /** What the next registration answers, when the token is good. */
  answer: RegistrationAnswer;
  /** What deleting the client answers. */
  deleteStatus: number;
  /** Every call to the registration endpoint, with its body and `Authorization` header. */
  registrations: Registration[];
  /** Every call to the endpoint a `redirect` answer points to, which registers whoever reaches it. */
  redirected: Registration[];
  /** The `Authorization` header of every request to delete the client. */
  deletions: (string | undefined)[];
  /** The sign-in half: who signs in next, and the browser's step at the authorize page. */
  oidc: OidcIssuer;
  /**
   * Builds the setup URL its admin would hand out.
   *
   * @param [token] - The initial access token. The good one by default.
   * @param [name] - What it calls itself. None by default.
   */
  setupUrl(token?: string, name?: string): string;
  close(): Promise<void>;
}

/** Statuses the registration endpoint answers with. */
const Status = {
  Created: 201,
  NoContent: 204,
  TemporaryRedirect: 307,
  BadRequest: 400,
  Unauthorized: 401,
  TooManyRequests: 429,
} as const;

/**
 * Starts the stand-in on a free loopback port, ready to register one client.
 *
 * @param [profile] - Who signs in once a client is registered. Ada, whose address it checked, by default.
 * @returns The provider and what it was asked.
 */
export async function startFakeDcr(
  profile: OidcProfile = { sub: 'o-ada', email: 'ada@example.com', email_verified: true, name: 'Ada' },
): Promise<FakeDcr> {
  const app = express();
  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${portOf(server)}`;
  const issuer = `${origin}/oidc`;
  /** The client registered, until it is deleted. */
  let client: OidcClient | undefined;

  const oidc = await mountOidcIssuer(app, origin, '/oidc', {
    client: () => client,
    profile,
    discovery: () => ({
      issuer: fake.claimedIssuer,
      ...(fake.canRegister ? { registration_endpoint: `${issuer}/register` } : {}),
    }),
  });

  const fake: FakeDcr = {
    issuer,
    claimedIssuer: issuer,
    canRegister: true,
    answer: 'created',
    deleteStatus: Status.NoContent,
    registrations: [],
    redirected: [],
    deletions: [],
    oidc,
    setupUrl(token = SETUP_TOKEN, name) {
      const params = new URLSearchParams({ setup: token, ...(name === undefined ? {} : { name }) });
      return `${issuer}#${params}`;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  app.post('/oidc/register', express.json(), (req, res) => {
    fake.registrations.push({ body: req.body, authorization: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${SETUP_TOKEN}` || client !== undefined) {
      res
        .status(Status.Unauthorized)
        .json({ error: 'invalid_token', error_description: 'the setup URL has been used' });
      return;
    }
    if (fake.answer === 'redirect') {
      // 307 keeps the method, the body and, on the same origin, the Authorization header.
      res.redirect(Status.TemporaryRedirect, `${issuer}/register-elsewhere`);
      return;
    }
    if (fake.answer === 'rateLimited') {
      res.status(Status.TooManyRequests).json({ error: 'too_many_requests' });
      return;
    }
    if (fake.answer === 'badRedirect') {
      res
        .status(Status.BadRequest)
        .json({ error: 'invalid_redirect_uri', error_description: BAD_REDIRECT_DESCRIPTION });
      return;
    }
    client = { ...REGISTERED };
    res.status(Status.Created).json({
      ...req.body,
      client_id: REGISTERED.clientId,
      client_secret: REGISTERED.clientSecret,
      registration_access_token: REGISTRATION_TOKEN,
      registration_client_uri: `${issuer}/register/${REGISTERED.clientId}`,
    });
  });
  app.post('/oidc/register-elsewhere', express.json(), (req, res) => {
    fake.redirected.push({ body: req.body, authorization: req.headers.authorization });
    client = { ...REGISTERED };
    res.status(Status.Created).json({ ...req.body, client_id: REGISTERED.clientId });
  });
  app.delete(`/oidc/register/${REGISTERED.clientId}`, (req, res) => {
    fake.deletions.push(req.headers.authorization);
    const isGone =
      req.headers.authorization === `Bearer ${REGISTRATION_TOKEN}` && fake.deleteStatus < Status.BadRequest;
    if (isGone) {
      client = undefined;
    }
    res.status(fake.deleteStatus).end();
  });
  return fake;
}
