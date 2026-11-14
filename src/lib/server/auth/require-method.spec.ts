import { describe, expect, it } from 'vitest';
import { requireMethod } from './require-method';

/** SES keys: a mail provider is configured, so magic link is in effect. */
const MAIL = { SES_ACCESS_KEY_ID: 'key-id', SES_SECRET_ACCESS_KEY: 'secret' };

function evt(authMethods?: string, env: Record<string, string> = MAIL) {
  return { platform: { env: { ...env, AUTH_METHODS: authMethods } } } as never;
}

describe('requireMethod', () => {
  it('throws a 404 for a method that is off', () => {
    expect.assertions(1);
    try {
      requireMethod(evt(), 'password');
    } catch (err) {
      expect((err as { status: number }).status).toBe(404);
    }
  });

  it('passes for a method that is on', () => {
    expect(() => requireMethod(evt('password'), 'password')).not.toThrow();
  });

  it('passes magic-link while mail can be delivered', () => {
    expect(() => requireMethod(evt(''), 'magic-link')).not.toThrow();
  });

  it('throws a 404 for magic-link when no mail provider is configured', () => {
    expect.assertions(1);
    try {
      requireMethod(evt('magic-link', {}), 'magic-link');
    } catch (err) {
      expect((err as { status: number }).status).toBe(404);
    }
  });
});
