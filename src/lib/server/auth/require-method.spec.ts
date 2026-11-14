import { describe, expect, it } from 'vitest';
import { requireMethod } from './require-method';

function evt(authMethods?: string) {
  return { platform: { env: { AUTH_METHODS: authMethods } } } as never;
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

  it('keeps magic-link always on', () => {
    expect(() => requireMethod(evt(''), 'magic-link')).not.toThrow();
  });
});
