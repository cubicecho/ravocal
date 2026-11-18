import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_SECRET,
  describeWeakSecret,
  halfSetProviders,
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
