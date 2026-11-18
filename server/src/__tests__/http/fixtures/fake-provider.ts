import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import type { ProviderEndpoints } from '../../../auth/providers.ts';
import { type ClientProviderConfig, ProviderId } from '../../../core/config.ts';
import { portOf } from '../../helpers.ts';
import { mountOidcIssuer, type OidcProfile } from './oidc-issuer.ts';

// A stand-in for Google and Facebook on one loopback port. Google's half does what an OpenID Connect provider does
// (oidc-issuer.ts): discovery, a JWKS, a code flow with the client secret in a Basic header, PKCE, and a signed id
// token carrying the nonce. Facebook's half does what Facebook Login does: no discovery, the secret in the token
// request's body, and the profile from a Graph-style `/me`.

/** Who signs in at Google next: the id token's claims. */
export type GoogleProfile = OidcProfile;

/** Who signs in at Facebook next: what `/me` answers. */
export interface FacebookProfile {
  id: string;
  name: string;
  email?: string;
}

/** The clients the app is given, one per provider. */
export const FAKE_PROVIDERS: readonly ClientProviderConfig[] = [
  { id: ProviderId.Google, name: 'Google', clientId: 'ravocal-google', clientSecret: 'google-secret' },
  { id: ProviderId.Facebook, name: 'Facebook', clientId: 'ravocal-facebook', clientSecret: 'facebook-secret' },
];

const [GOOGLE_CLIENT, FACEBOOK_CLIENT] = FAKE_PROVIDERS;

/** What a token endpoint answers a client that cannot prove who it is. */
const UNAUTHORIZED = 401;
/** What a token or profile endpoint answers a code or token it does not know. */
const BAD_REQUEST = 400;

/** A pending Facebook authorization: what the token endpoint checks the code against. */
interface Grant {
  redirectUri: string;
  facebook: FacebookProfile;
}

export interface FakeProvider {
  /** Where the app is told the providers are. */
  endpoints: ProviderEndpoints;
  /** The issuer Google's half answers as. */
  googleIssuer: string;
  /** Who the next Google sign-in is. */
  google: GoogleProfile;
  /** Who the next Facebook sign-in is. */
  facebook: FacebookProfile;
  /**
   * Plays the browser at an authorize page the app sent it to: the reader agrees, and the provider would redirect
   * back with these.
   */
  authorize(url: string): { code: string; state: string };
  close(): Promise<void>;
}

/**
 * Starts the stand-in on a free loopback port.
 *
 * @returns The provider, with Ada signing in at either half.
 */
export async function startFakeProvider(): Promise<FakeProvider> {
  const grants = new Map<string, Grant>();
  /** Facebook's access tokens, to the profile each was issued for. */
  const facebookTokens = new Map<string, FacebookProfile>();
  const app = express();
  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${portOf(server)}`;
  const google = await mountOidcIssuer(app, origin, '/google', {
    client: () => GOOGLE_CLIENT,
    profile: { sub: 'g-ada', email: 'ada@example.com', email_verified: true, name: 'Ada' },
  });

  /**
   * Takes the grant a Facebook code was issued for, once, if the redirect URI matches it. Facebook uses no PKCE.
   *
   * @param body - The token request's form fields.
   * @returns The grant, or undefined to refuse.
   */
  const redeem = (body: Record<string, string>): Grant | undefined => {
    const grant = grants.get(body.code);
    grants.delete(body.code);
    return grant !== undefined && grant.redirectUri === body.redirect_uri ? grant : undefined;
  };

  const fake: FakeProvider = {
    googleIssuer: google.issuer,
    endpoints: {
      google: { discoveryUrl: `${google.issuer}/.well-known/openid-configuration` },
      facebook: {
        authorizationUrl: `${origin}/facebook/dialog/oauth`,
        tokenUrl: `${origin}/facebook/oauth/access_token`,
        profileUrl: `${origin}/facebook/me?fields=id,name,email,picture`,
      },
    },
    get google() {
      return google.profile;
    },
    set google(profile) {
      google.profile = profile;
    },
    facebook: { id: 'fb-ada', name: 'Ada', email: 'ada@example.com' },
    authorize(url) {
      if (url.startsWith(google.issuer)) {
        return google.authorize(url);
      }
      const params = new URL(url).searchParams;
      if (params.get('client_id') !== FACEBOOK_CLIENT.clientId || params.get('response_type') !== 'code') {
        throw new Error(`The authorize request is not for ${FACEBOOK_CLIENT.clientId}: ${url}`);
      }
      const code = randomUUID();
      grants.set(code, { redirectUri: params.get('redirect_uri') ?? '', facebook: { ...fake.facebook } });
      return { code, state: params.get('state') ?? '' };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  app.post('/facebook/oauth/access_token', express.urlencoded({ extended: false }), (req, res) => {
    const isClient =
      req.body.client_id === FACEBOOK_CLIENT.clientId && req.body.client_secret === FACEBOOK_CLIENT.clientSecret;
    if (isClient === false) {
      res.status(UNAUTHORIZED).json({ error: { message: 'Error validating client secret.', type: 'OAuthException' } });
      return;
    }
    const grant = redeem(req.body);
    if (grant === undefined) {
      res.status(BAD_REQUEST).json({ error: { message: 'Invalid verification code format.', type: 'OAuthException' } });
      return;
    }
    const accessToken = `facebook-${randomUUID()}`;
    facebookTokens.set(accessToken, grant.facebook);
    res.json({ access_token: accessToken, token_type: 'bearer', expires_in: 5_183_944 });
  });
  app.get('/facebook/me', (req, res) => {
    const profile = facebookTokens.get(String(req.headers.authorization).replace('Bearer ', ''));
    if (profile === undefined) {
      res.status(BAD_REQUEST).json({ error: { message: 'Invalid OAuth access token.', type: 'OAuthException' } });
      return;
    }
    res.json({ ...profile, picture: { data: { url: `https://example.com/${profile.id}.png` } } });
  });
  return fake;
}
