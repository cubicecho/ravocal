import { createHash, randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

// What an OpenID Connect provider does, mounted under a path of a stand-in's loopback server: discovery, a JWKS, and a
// code flow whose token endpoint authenticates the client as it was registered (the secret in a Basic header or in the
// form, or no secret at all for a public client), checks PKCE, and signs an id token carrying the nonce; and a userinfo
// endpoint, which better-auth asks when the id token has no address. Google's half of fake-provider.ts is one; the paired provider (sso/fixtures/fake-dcr.ts) is
// another.

/** Who signs in next: the id token's claims. */
export interface OidcProfile {
  sub: string;
  email?: string;
  /** Left out, the provider has not said it checked the address. */
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

/** How a client proves itself at the token endpoint (RFC 7591's `token_endpoint_auth_method`). */
export type OidcClientMethod = 'client_secret_basic' | 'client_secret_post' | 'none';

/** The client the token endpoint accepts. */
export interface OidcClient {
  clientId: string;
  /** Absent for a public client, which proves itself with PKCE alone. */
  clientSecret?: string;
  /** How it sends its secret. `client_secret_basic` when left out. */
  method?: OidcClientMethod;
}

/** The token request's form fields that carry a client's credentials. */
interface ClientCredentials {
  client_id?: string;
  client_secret?: string;
}

/** What a token endpoint answers a client that cannot prove who it is. */
const UNAUTHORIZED = 401;
/** What a token endpoint answers a code it does not know. */
const BAD_REQUEST = 400;

/** A pending authorization: what the token endpoint checks the code against. */
interface Grant {
  clientId: string;
  nonce: string;
  challenge: string;
  redirectUri: string;
  profile: OidcProfile;
}

/** One provider mounted on a stand-in. */
export interface OidcIssuer {
  /** The issuer it answers as: the origin and the path it is mounted under. */
  issuer: string;
  /** Who the next sign-in is. */
  profile: OidcProfile;
  /**
   * Plays the browser at an authorize page the app sent it to: the reader agrees, and the provider would redirect back
   * with these.
   */
  authorize(url: string): { code: string; state: string };
}

/** How a provider is mounted. */
export interface OidcIssuerOptions {
  /** The client its endpoints accept, read on each request: undefined while it has none. */
  client: () => OidcClient | undefined;
  /** Who signs in first. */
  profile: OidcProfile;
  /** Fields the discovery document adds or replaces, read on each request. */
  discovery?: () => Record<string, unknown>;
}

/**
 * Mounts a provider under a path.
 *
 * @param app - The stand-in's Express app.
 * @param origin - Where the stand-in listens.
 * @param path - The path it is mounted under, which ends the issuer: `/google`.
 * @param options - Its client and first reader.
 * @returns The provider.
 */
export async function mountOidcIssuer(
  app: Express,
  origin: string,
  path: string,
  options: OidcIssuerOptions,
): Promise<OidcIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const grants = new Map<string, Grant>();
  /** The access tokens issued, to the profile each was issued for. */
  const accessTokens = new Map<string, OidcProfile>();
  const issuer = `${origin}${path}`;

  const provider: OidcIssuer = {
    issuer,
    profile: options.profile,
    authorize(url) {
      const params = new URL(url).searchParams;
      const client = options.client();
      if (
        client === undefined ||
        params.get('client_id') !== client.clientId ||
        params.get('response_type') !== 'code'
      ) {
        throw new Error(`The authorize request is not for ${client?.clientId ?? 'a registered client'}: ${url}`);
      }
      const code = randomUUID();
      grants.set(code, {
        clientId: client.clientId,
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        profile: { ...provider.profile },
      });
      return { code, state: params.get('state') ?? '' };
    },
  };

  /**
   * Whether a token request proves it comes from the client, the way that client was registered to prove it.
   *
   * @param authorization - The request's `Authorization` header.
   * @param body - The request's form fields.
   * @param client - The client.
   * @returns true when it does, and by no other method.
   */
  const authenticates = (authorization: string | undefined, body: ClientCredentials, client: OidcClient): boolean => {
    const method = client.method ?? 'client_secret_basic';
    if (method === 'client_secret_basic') {
      const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
      return authorization === `Basic ${basic}` && body.client_secret === undefined;
    }
    const inForm = authorization === undefined && body.client_id === client.clientId;
    if (method === 'client_secret_post') {
      return inForm && body.client_secret === client.clientSecret;
    }
    return inForm && body.client_secret === undefined;
  };

  /**
   * Takes the grant a code was issued for, once, if the client, PKCE verifier and redirect URI match it.
   *
   * @param body - The token request's form fields.
   * @param client - The client that authenticated.
   * @returns The grant, or undefined to refuse.
   */
  const redeem = (body: Record<string, string>, client: OidcClient): Grant | undefined => {
    const grant = grants.get(body.code);
    grants.delete(body.code);
    const challenge = createHash('sha256')
      .update(String(body.code_verifier ?? ''))
      .digest('base64url');
    const isValid =
      grant !== undefined &&
      grant.clientId === client.clientId &&
      grant.redirectUri === body.redirect_uri &&
      grant.challenge === challenge;
    return isValid ? grant : undefined;
  };

  app.get(`${path}/.well-known/openid-configuration`, (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      ...options.discovery?.(),
    });
  });
  app.get(`${path}/jwks`, (_req, res) => {
    res.json({ keys: [jwk] });
  });
  app.get(`${path}/userinfo`, (req, res) => {
    const profile = accessTokens.get(String(req.headers.authorization).replace('Bearer ', ''));
    if (profile === undefined) {
      res.status(UNAUTHORIZED).json({ error: 'invalid_token' });
      return;
    }
    res.json(profile);
  });
  app.post(`${path}/token`, express.urlencoded({ extended: false }), async (req, res) => {
    const client = options.client();
    if (client === undefined || authenticates(req.headers.authorization, req.body, client) === false) {
      res.status(UNAUTHORIZED).json({ error: 'invalid_client' });
      return;
    }
    const grant = redeem(req.body, client);
    if (grant === undefined) {
      res.status(BAD_REQUEST).json({ error: 'invalid_grant' });
      return;
    }
    const { sub, ...claims } = grant.profile;
    const idToken = await new SignJWT({ ...claims, nonce: grant.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(client.clientId)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const accessToken = `${path.slice(1)}-${randomUUID()}`;
    accessTokens.set(accessToken, grant.profile);
    res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  return provider;
}
