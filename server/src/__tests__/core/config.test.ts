import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_SECRET,
  describeWeakSecret,
  halfSetProviders,
  oidcConfig,
  oidcConfigProblems,
  PLACEHOLDER_SECRET,
  ProviderId,
  providerConfigs,
  providerRedirectUri,
  secureLocalNet,
  serverUrl,
  smtpFrom,
} from '../../core/config.ts';
import { AUTH_DEFAULTS } from '../../core/defaults.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('describeWeakSecret', () => {
  it.each([undefined, ''])('says %o is not set', (secret) => {
    expect(describeWeakSecret(secret)).toBe('is not set');
  });

  it.each([DEV_SECRET, PLACEHOLDER_SECRET])('refuses the published default %s', (secret) => {
    expect(describeWeakSecret(secret)).toBe('is a published default');
  });

  it('refuses a secret one character short', () => {
    const secret = 'x'.repeat(AUTH_DEFAULTS.minSecretLength - 1);
    expect(describeWeakSecret(secret)).toBe(`is shorter than ${AUTH_DEFAULTS.minSecretLength} characters`);
  });

  it('accepts a secret of the minimum length', () => {
    expect(describeWeakSecret('x'.repeat(AUTH_DEFAULTS.minSecretLength))).toBeUndefined();
  });
});

describe('secureLocalNet', () => {
  it('keeps the default when unset', () => {
    vi.stubEnv('SECURE_LOCAL_NET', '');
    expect(secureLocalNet()).toBe(AUTH_DEFAULTS.secureLocalNet);
  });

  it.each(['1', 'true', 'YES', ' True '])('is on for %o', (value) => {
    vi.stubEnv('SECURE_LOCAL_NET', value);
    expect(secureLocalNet()).toBe(true);
  });

  it.each(['0', 'false', 'off'])('is off for %o', (value) => {
    vi.stubEnv('SECURE_LOCAL_NET', value);
    expect(secureLocalNet()).toBe(false);
  });
});

describe('smtpFrom', () => {
  it("defaults to ravocal@ APP_URL's host", () => {
    vi.stubEnv('SMTP_FROM', '');
    vi.stubEnv('APP_URL', 'https://ravocal.example.com:8443');
    expect(smtpFrom()).toBe('ravocal@ravocal.example.com');
  });

  it('is SMTP_FROM when set', () => {
    vi.stubEnv('SMTP_FROM', 'meetings@example.com');
    expect(smtpFrom()).toBe('meetings@example.com');
  });
});

describe('serverUrl', () => {
  it('is APP_URL when SERVER_URL is unset, since the app and the server share an origin', () => {
    vi.stubEnv('APP_URL', 'http://localhost:5173');
    expect(serverUrl()).toBe('http://localhost:5173');
  });

  it('is SERVER_URL when set, and the redirect URIs follow it', () => {
    vi.stubEnv('APP_URL', 'http://localhost:5173');
    vi.stubEnv('SERVER_URL', 'http://localhost:3001');
    expect(serverUrl()).toBe('http://localhost:3001');
    expect(providerRedirectUri(ProviderId.Google)).toBe('http://localhost:3001/api/auth/callback/google');
  });
});

describe('providerConfigs', () => {
  it('offers no provider when none is set', () => {
    expect(providerConfigs()).toEqual([]);
    expect(halfSetProviders()).toEqual([]);
  });

  it('offers a provider whose id and secret are both set, trimmed', () => {
    vi.stubEnv('FACEBOOK_CLIENT_ID', ' 1234 ');
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'shh');
    expect(providerConfigs()).toEqual([
      { id: ProviderId.Facebook, name: 'Facebook', clientId: '1234', clientSecret: 'shh' },
    ]);
  });

  it.each([
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID'],
  ])('turns Google off, and preflight names what is missing, when only %s is set', (set, missing) => {
    vi.stubEnv(set, 'value');
    expect(providerConfigs()).toEqual([]);
    const [problem] = halfSetProviders();
    expect(problem).toContain(`${set} is set but ${missing} is not`);
  });
});

describe('oidcConfig', () => {
  it('is null, and preflight finds nothing wrong, with neither OIDC_ISSUER nor OIDC_CLIENT_ID', () => {
    expect(oidcConfig()).toBeNull();
    expect(oidcConfigProblems()).toEqual([]);
  });

  it('reads a public client with the defaults, the issuer without its trailing slash', () => {
    vi.stubEnv('OIDC_ISSUER', 'https://id.example.com/oidc/');
    vi.stubEnv('OIDC_CLIENT_ID', ' ravocal ');
    expect(oidcConfig()).toEqual({
      issuer: 'https://id.example.com/oidc',
      clientId: 'ravocal',
      clientSecret: undefined,
      clientAuth: AUTH_DEFAULTS.oidcClientAuth,
      name: AUTH_DEFAULTS.oidcName,
    });
    expect(oidcConfigProblems()).toEqual([]);
  });

  it('reads a confidential client, how it sends its secret, and its name', () => {
    vi.stubEnv('OIDC_ISSUER', 'https://id.example.com/oidc');
    vi.stubEnv('OIDC_CLIENT_ID', 'ravocal');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'shh');
    vi.stubEnv('OIDC_CLIENT_AUTH', 'client_secret_post');
    vi.stubEnv('OIDC_NAME', 'Corp SSO');
    expect(oidcConfig()).toMatchObject({ clientSecret: 'shh', clientAuth: 'client_secret_post', name: 'Corp SSO' });
  });

  it.each([
    ['OIDC_ISSUER', 'https://id.example.com/oidc', 'OIDC_CLIENT_ID'],
    ['OIDC_CLIENT_ID', 'ravocal', 'OIDC_ISSUER'],
  ])('is off, and preflight names what is missing, when only %s is set', (set, value, missing) => {
    vi.stubEnv(set, value);
    expect(oidcConfig()).toBeNull();
    expect(oidcConfigProblems()).toEqual([expect.stringContaining(`${set} is set but ${missing} is not`)]);
  });

  it.each(['id.example.com', 'ftp://id.example.com/oidc'])('has preflight refuse the issuer %s', (issuer) => {
    vi.stubEnv('OIDC_ISSUER', issuer);
    vi.stubEnv('OIDC_CLIENT_ID', 'ravocal');
    expect(oidcConfigProblems()).toEqual([expect.stringContaining('is not an http(s) URL')]);
  });

  it('has preflight refuse an http:// issuer on a public host in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OIDC_ISSUER', 'http://id.example.com/oidc');
    vi.stubEnv('OIDC_CLIENT_ID', 'ravocal');
    expect(oidcConfigProblems()).toEqual([expect.stringContaining("Set it to the provider's https:// address")]);
  });

  it.each([
    ['in production, over https', 'production', 'https://id.example.com/oidc'],
    ['in production, on this machine', 'production', 'http://127.0.0.1:8080/oidc'],
    ['in production, on a private network', 'production', 'http://id.lan/oidc'],
    ['in development, anywhere', 'development', 'http://id.example.com/oidc'],
  ])('lets preflight accept an issuer %s', (_where, nodeEnv, issuer) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('OIDC_ISSUER', issuer);
    vi.stubEnv('OIDC_CLIENT_ID', 'ravocal');
    expect(oidcConfigProblems()).toEqual([]);
  });

  it('has preflight refuse a client auth it does not know', () => {
    vi.stubEnv('OIDC_ISSUER', 'https://id.example.com/oidc');
    vi.stubEnv('OIDC_CLIENT_ID', 'ravocal');
    vi.stubEnv('OIDC_CLIENT_AUTH', 'private_key_jwt');
    expect(oidcConfigProblems()).toEqual([
      expect.stringContaining('OIDC_CLIENT_AUTH (private_key_jwt) must be one of'),
    ]);
  });
});
