import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePlatform } from '$lib/server/test/auth-db';
import {
  E2E_AUTH_METHODS_COOKIE,
  enabledAuthMethods,
  methodForAuthPath,
  parseAuthMethods
} from './methods';

/** SES keys: a mail provider is configured, so magic link can be in effect. */
const MAIL = { SES_ACCESS_KEY_ID: 'key-id', SES_SECRET_ACCESS_KEY: 'secret' };

/** A platform with only env vars (no DB is touched by `enabledAuthMethods`). */
function bare(env: Record<string, unknown>): App.Platform {
  return makePlatform(undefined as unknown as D1Database, env);
}

/** A platform with a mail provider configured, plus `env`. */
function platform(env: Record<string, unknown>): App.Platform {
  return bare({ ...MAIL, ...env });
}

function cookies(value: string | undefined) {
  return { get: (name: string) => (name === E2E_AUTH_METHODS_COOKIE ? value : undefined) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseAuthMethods', () => {
  it('defaults to magic link only', () => {
    expect([...parseAuthMethods(undefined)]).toEqual(['magic-link']);
  });

  it('always keeps magic link and drops unknown tokens', () => {
    expect([...parseAuthMethods('password, bogus')].sort()).toEqual(['magic-link', 'password']);
  });

  it('reads every known method from a comma list', () => {
    expect([...parseAuthMethods(' passkey ,google,password,magic-link')].sort()).toEqual([
      'google',
      'magic-link',
      'passkey',
      'password'
    ]);
  });
});

describe('enabledAuthMethods', () => {
  it('drops google without a client id and secret', () => {
    const methods = enabledAuthMethods({ platform: platform({ AUTH_METHODS: 'google,password' }) });
    expect([...methods].sort()).toEqual(['magic-link', 'password']);
  });

  it('keeps google when the client id and secret are set', () => {
    const methods = enabledAuthMethods({
      platform: platform({
        AUTH_METHODS: 'google',
        GOOGLE_CLIENT_ID: 'gid',
        GOOGLE_CLIENT_SECRET: 'gsecret'
      })
    });
    expect([...methods].sort()).toEqual(['google', 'magic-link']);
  });

  it('gives magic link only with a mail provider and no AUTH_METHODS', () => {
    expect([...enabledAuthMethods({ platform: platform({}) })]).toEqual(['magic-link']);
  });

  it('keeps magic link with Resend configured', () => {
    const methods = enabledAuthMethods({
      platform: bare({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' })
    });
    expect([...methods]).toEqual(['magic-link']);
  });

  it('drops magic link when no mail provider is configured', () => {
    expect([...enabledAuthMethods({ platform: bare({ AUTH_METHODS: 'magic-link' }) })]).toEqual([]);
  });

  it('gives nothing with no platform (no mail provider)', () => {
    expect([...enabledAuthMethods({})]).toEqual([]);
  });

  it('keeps the other listed methods when no mail provider is configured', () => {
    const methods = enabledAuthMethods({ platform: bare({ AUTH_METHODS: 'password' }) });
    expect([...methods]).toEqual(['password']);
  });

  it('drops magic link without a mail provider in development outside an e2e build', () => {
    const methods = enabledAuthMethods({ platform: bare({ ENVIRONMENT: 'development' }) });
    expect([...methods]).toEqual([]);
  });

  it('keeps magic link without a mail provider in an e2e build (the mail sink stands in)', () => {
    vi.stubEnv('VITE_E2E', '1');
    const methods = enabledAuthMethods({
      platform: bare({ AUTH_METHODS: 'magic-link', ENVIRONMENT: 'development' }),
      cookies: cookies(undefined)
    });
    expect([...methods]).toEqual(['magic-link']);
  });

  it('ignores the e2e cookie outside an e2e build', () => {
    const methods = enabledAuthMethods({
      platform: platform({ AUTH_METHODS: 'magic-link', ENVIRONMENT: 'development' }),
      cookies: cookies('password,passkey')
    });
    expect([...methods]).toEqual(['magic-link']);
  });

  it('ignores the e2e cookie in an e2e build outside development', () => {
    vi.stubEnv('VITE_E2E', '1');
    const methods = enabledAuthMethods({
      platform: platform({ AUTH_METHODS: 'magic-link', ENVIRONMENT: 'production' }),
      cookies: cookies('password,passkey')
    });
    expect([...methods]).toEqual(['magic-link']);
  });

  it('takes the e2e cookie in an e2e build in development', () => {
    vi.stubEnv('VITE_E2E', '1');
    const methods = enabledAuthMethods({
      platform: platform({ AUTH_METHODS: 'magic-link', ENVIRONMENT: 'development' }),
      cookies: cookies('password,passkey')
    });
    expect([...methods].sort()).toEqual(['magic-link', 'passkey', 'password']);
  });

  it('keeps the env value in an e2e build when the cookie is absent', () => {
    vi.stubEnv('VITE_E2E', '1');
    const methods = enabledAuthMethods({
      platform: platform({ AUTH_METHODS: 'magic-link,password', ENVIRONMENT: 'development' }),
      cookies: cookies(undefined)
    });
    expect([...methods].sort()).toEqual(['magic-link', 'password']);
  });

  it('drops google from the e2e cookie without a client id and secret', () => {
    vi.stubEnv('VITE_E2E', '1');
    const methods = enabledAuthMethods({
      platform: platform({ ENVIRONMENT: 'development' }),
      cookies: cookies('google')
    });
    expect([...methods]).toEqual(['magic-link']);
  });
});

describe('methodForAuthPath', () => {
  it('maps Better-Auth paths to their method', () => {
    expect(methodForAuthPath('/api/auth/passkey/generate-register-options')).toBe('passkey');
    expect(methodForAuthPath('/api/auth/callback/google')).toBe('google');
    expect(methodForAuthPath('/api/auth/get-session')).toBeNull();
  });

  it('maps every password path to password', () => {
    for (const p of [
      '/sign-in/email',
      '/request-password-reset',
      '/reset-password',
      '/change-password'
    ]) {
      expect(methodForAuthPath(`/api/auth${p}`)).toBe('password');
    }
  });

  it('maps the reset link callback to password', () => {
    expect(methodForAuthPath('/api/auth/reset-password/abc123')).toBe('password');
  });

  it('maps email sign-up to password', () => {
    expect(methodForAuthPath('/api/auth/sign-up/email')).toBe('password');
  });

  it('maps password verification to password', () => {
    expect(methodForAuthPath('/api/auth/verify-password')).toBe('password');
  });

  it('maps every passkey endpoint to passkey', () => {
    for (const p of [
      '/passkey/generate-register-options',
      '/passkey/generate-authenticate-options',
      '/passkey/verify-registration',
      '/passkey/verify-authentication',
      '/passkey/list-user-passkeys',
      '/passkey/delete-passkey',
      '/passkey/update-passkey'
    ]) {
      expect(methodForAuthPath(`/api/auth${p}`)).toBe('passkey');
    }
  });

  it('maps every Google path to google', () => {
    for (const p of ['/sign-in/social', '/link-social', '/callback/google']) {
      expect(methodForAuthPath(`/api/auth${p}`)).toBe('google');
    }
  });

  it('ignores a trailing slash', () => {
    expect(methodForAuthPath('/api/auth/sign-in/email/')).toBe('password');
    expect(methodForAuthPath('/api/auth/reset-password/')).toBe('password');
    expect(methodForAuthPath('/api/auth/link-social/')).toBe('google');
    expect(methodForAuthPath('/api/auth/get-session/')).toBeNull();
  });

  it('maps every path that sends mail to magic link', () => {
    for (const p of [
      '/sign-in/magic-link',
      '/send-verification-email',
      '/change-email',
      '/verify-email'
    ]) {
      expect(methodForAuthPath(`/api/auth${p}`)).toBe('magic-link');
      expect(methodForAuthPath(`/api/auth${p}/`)).toBe('magic-link');
    }
  });

  it('leaves the always-on paths and foreign paths unmapped', () => {
    for (const p of [
      '/api/auth/sign-in/anonymous',
      '/api/auth/magic-link/verify',
      '/api/auth/sign-out',
      '/api/auth/passkey',
      '/passkey/generate-register-options',
      '/api/other/sign-in/email'
    ]) {
      expect(methodForAuthPath(p)).toBeNull();
    }
  });
});
