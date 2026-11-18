import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ProviderEndpoints } from '../../../auth/providers.ts';
import { type ProviderConfig, ProviderId } from '../../../core/config.ts';
import { portOf } from '../../helpers.ts';

// A stand-in for Google and Facebook on one loopback port. Google's half does what an OpenID Connect provider does:
// discovery, a JWKS, a code flow with the client secret in a Basic header, PKCE, and a signed id token carrying the
// nonce. Facebook's half does what Facebook Login does: no discovery, the secret in the token request's body, and the
// profile from a Graph-style `/me`.

/** Who signs in at Google next: the id token's claims. */
export interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** Who signs in at Facebook next: what `/me` answers. */
export interface FacebookProfile {
  id: string;
  name: string;
  email?: string;
}

/** The clients the app is given, one per provider. */
export const FAKE_PROVIDERS: readonly ProviderConfig[] = [
  { id: ProviderId.Google, name: 'Google', clientId: 'ravocal-google', clientSecret: 'google-secret' },
  { id: ProviderId.Facebook, name: 'Facebook', clientId: 'ravocal-facebook', clientSecret: 'facebook-secret' },
];

const [GOOGLE_CLIENT, FACEBOOK_CLIENT] = FAKE_PROVIDERS;

/** What a token endpoint answers a client that cannot prove who it is. */
const UNAUTHORIZED = 401;
/** What a token or profile endpoint answers a code or token it does not know. */
const BAD_REQUEST = 400;

/** A pending authorization: what the token endpoint checks the code against. */
interface Grant {
  provider: ProviderId;
  nonce: string;
  challenge: string;
  redirectUri: string;
  google: GoogleProfile;
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
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const grants = new Map<string, Grant>();
  /** Facebook's access tokens, to the profile each was issued for. */
  const facebookTokens = new Map<string, FacebookProfile>();
  const app = express();
  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${portOf(server)}`;
  const googleIssuer = `${origin}/google`;

  /**
   * Takes the grant a code was issued for, once, if the PKCE verifier and redirect URI match it.
   *
   * @param body - The token request's form fields.
   * @param provider - Which half is asked.
   * @param pkce - Whether the verifier must match.
   * @returns The grant, or undefined to refuse.
   */
  const redeem = (body: Record<string, string>, provider: ProviderId, pkce: boolean): Grant | undefined => {
    const grant = grants.get(body.code);
    grants.delete(body.code);
    const challenge = createHash('sha256')
      .update(String(body.code_verifier ?? ''))
      .digest('base64url');
    const isValid =
      grant !== undefined &&
      grant.provider === provider &&
      grant.redirectUri === body.redirect_uri &&
      (pkce === false || grant.challenge === challenge);
    return isValid ? grant : undefined;
  };

  const fake: FakeProvider = {
    googleIssuer,
    endpoints: {
      google: { discoveryUrl: `${googleIssuer}/.well-known/openid-configuration` },
      facebook: {
        authorizationUrl: `${origin}/facebook/dialog/oauth`,
        tokenUrl: `${origin}/facebook/oauth/access_token`,
        profileUrl: `${origin}/facebook/me?fields=id,name,email,picture`,
      },
    },
    google: { sub: 'g-ada', email: 'ada@example.com', email_verified: true, name: 'Ada' },
    facebook: { id: 'fb-ada', name: 'Ada', email: 'ada@example.com' },
    authorize(url) {
      const params = new URL(url).searchParams;
      const provider = url.startsWith(googleIssuer) ? ProviderId.Google : ProviderId.Facebook;
      const client = provider === ProviderId.Google ? GOOGLE_CLIENT : FACEBOOK_CLIENT;
      if (params.get('client_id') !== client.clientId || params.get('response_type') !== 'code') {
        throw new Error(`The authorize request is not for ${client.clientId}: ${url}`);
      }
      const code = randomUUID();
      grants.set(code, {
        provider,
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        google: { ...fake.google },
        facebook: { ...fake.facebook },
      });
      return { code, state: params.get('state') ?? '' };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  app.get('/google/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: googleIssuer,
      authorization_endpoint: `${googleIssuer}/auth`,
      token_endpoint: `${googleIssuer}/token`,
      userinfo_endpoint: `${googleIssuer}/userinfo`,
      jwks_uri: `${googleIssuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    });
  });
  app.get('/google/jwks', (_req, res) => {
    res.json({ keys: [jwk] });
  });
  app.post('/google/token', express.urlencoded({ extended: false }), async (req, res) => {
    const basic = Buffer.from(`${GOOGLE_CLIENT.clientId}:${GOOGLE_CLIENT.clientSecret}`).toString('base64');
    if (req.headers.authorization !== `Basic ${basic}`) {
      res.status(UNAUTHORIZED).json({ error: 'invalid_client' });
      return;
    }
    const grant = redeem(req.body, ProviderId.Google, true);
    if (grant === undefined) {
      res.status(BAD_REQUEST).json({ error: 'invalid_grant' });
      return;
    }
    const { sub, ...claims } = grant.google;
    const idToken = await new SignJWT({ ...claims, nonce: grant.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(googleIssuer)
      .setAudience(GOOGLE_CLIENT.clientId)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res.json({ access_token: `google-${sub}`, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  app.post('/facebook/oauth/access_token', express.urlencoded({ extended: false }), (req, res) => {
    const isClient =
      req.body.client_id === FACEBOOK_CLIENT.clientId && req.body.client_secret === FACEBOOK_CLIENT.clientSecret;
    if (isClient === false) {
      res.status(UNAUTHORIZED).json({ error: { message: 'Error validating client secret.', type: 'OAuthException' } });
      return;
    }
    const grant = redeem(req.body, ProviderId.Facebook, false);
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
