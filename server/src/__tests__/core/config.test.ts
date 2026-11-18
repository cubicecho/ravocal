import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_SECRET, describeWeakSecret, PLACEHOLDER_SECRET, secureLocalNet, smtpFrom } from '../../core/config.ts';
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
