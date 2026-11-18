import { describe, expect, it } from 'vitest';
import { DEV_SECRET, describeWeakSecret, PLACEHOLDER_SECRET } from '../../core/config.ts';
import { AUTH_DEFAULTS } from '../../core/defaults.ts';

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
