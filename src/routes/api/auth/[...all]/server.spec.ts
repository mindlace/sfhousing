import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { mockConsole } from '$lib/server/test/mock-console';

const { authFor, getAuth } = vi.hoisted(() => ({ authFor: vi.fn(), getAuth: vi.fn() }));
vi.mock('$lib/server/auth/better-auth', () => ({ authFor, getAuth }));

// The real enforceRate (so the FakeRateLimiter bindings and ENVIRONMENT decide), wrapped in a
// spy so the cases can read the options each call passes.
const { enforceRate } = vi.hoisted(() => ({ enforceRate: vi.fn() }));
vi.mock('$lib/server/security/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/security/rate-limit')>();
  enforceRate.mockImplementation(actual.enforceRate);
  return { ...actual, enforceRate };
});

import { POST, GET } from './+server';

/** Every switchable method on, so the ported limiter and pass-through cases reach Better-Auth. */
const ALL_ON = {
  AUTH_METHODS: 'magic-link,password,passkey,google',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret'
};

/** SES keys: a mail provider is configured, so magic link is in effect. */
const MAIL = { SES_ACCESS_KEY_ID: 'key-id', SES_SECRET_ACCESS_KEY: 'secret' };
/** Overrides MAIL: no mail provider, so magic link is not in effect. */
const NO_MAIL = { SES_ACCESS_KEY_ID: undefined, SES_SECRET_ACCESS_KEY: undefined };

let AUTH_PASSWORD_RL: FakeRateLimiter;
let AUTH_LINK_RL: FakeRateLimiter;

function authEvent(
  method: string,
  path: string,
  body?: unknown,
  env: Record<string, unknown> = ALL_ON
) {
  return {
    request: new Request(`http://x${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    }),
    platform: {
      env: { ENVIRONMENT: 'production', AUTH_PASSWORD_RL, AUTH_LINK_RL, ...MAIL, ...env }
    },
    cookies: { get: () => undefined },
    url: new URL(`http://x${path}`)
  } as unknown as Parameters<typeof POST>[0];
}

/** Both limiters' recorded keys, in call order per limiter. */
const passwordKeys = () => AUTH_PASSWORD_RL.calls;
const linkKeys = () => AUTH_LINK_RL.calls;
const limiterCalls = () => passwordKeys().length + linkKeys().length;

const SIGN_IN_EMAIL = '/api/auth/sign-in/email';
const RESET = '/api/auth/request-password-reset';
const RESET_PASSWORD = '/api/auth/reset-password';
const TOO_MANY = 429;

const authHandler = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  enforceRate.mockClear();
  authFor.mockReset();
  getAuth.mockReset();
  authHandler.mockReset();
  AUTH_PASSWORD_RL = new FakeRateLimiter({ allow: 100 });
  AUTH_LINK_RL = new FakeRateLimiter({ allow: 100 });
  authHandler.mockResolvedValue(new Response('ok'));
  authFor.mockReturnValue({ handler: authHandler });
});

describe('auth catch-all', () => {
  it('404s POST /api/auth/sign-in/anonymous without hitting Better-Auth', async () => {
    const res = await POST(authEvent('POST', '/api/auth/sign-in/anonymous'));
    expect(res.status).toBe(404);
    expect(authFor).not.toHaveBeenCalled();
  });

  it('passes other POST auth routes through to Better-Auth', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('ok'));
    authFor.mockReturnValue({ handler });
    const res = await POST(authEvent('POST', '/api/auth/sign-in/social'));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('passes GET requests through (the pseudonymous block is POST-only)', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('ok'));
    authFor.mockReturnValue({ handler });
    await GET(authEvent('GET', '/api/auth/sign-in/anonymous'));
    expect(handler).toHaveBeenCalled();
  });

  it('404s the trailing-slash variant', async () => {
    const res = await POST(authEvent('POST', '/api/auth/sign-in/anonymous/'));
    expect(res.status).toBe(404);
  });

  it('404s a case variant', async () => {
    const res = await POST(authEvent('POST', '/api/auth/sign-in/Anonymous'));
    expect(res.status).toBe(404);
  });

  it('hands Better-Auth the request through authFor(event)', async () => {
    const e = authEvent('GET', '/api/auth/get-session');
    await GET(e);
    expect(authFor).toHaveBeenCalledWith(e);
    expect(authHandler).toHaveBeenCalledWith(e.request);
    expect(getAuth).not.toHaveBeenCalled();
  });
});

/**
 * The raw endpoints are the twins of the `/signin` form actions. Without these limits the
 * form action's dual-dimension throttle is bypassable by posting directly here.
 */
describe('raw password sign-in rate limiting', () => {
  it('limits BOTH the IP and the email dimension on the AUTH_PASSWORD_RL binding', async () => {
    await POST(authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' }));
    expect(passwordKeys()).toHaveLength(2);
    expect(linkKeys()).toHaveLength(0);
    expect(passwordKeys().some((k) => k.startsWith('auth_pw_ip:'))).toBe(true);
    expect(passwordKeys()).toContain('auth_pw_email:a@b.test');
  });

  it('429s WITHOUT reaching Better-Auth when the IP limit is exceeded', async () => {
    AUTH_PASSWORD_RL = new FakeRateLimiter({ allow: 0 });
    const res = await POST(authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' }));
    expect(res.status).toBe(TOO_MANY);
    expect(authFor).not.toHaveBeenCalled();
  });

  it('429s when only the per-email limit is exceeded (distributed spraying)', async () => {
    // IP dimension passes, email dimension fails — the botnet case the form action guards.
    AUTH_PASSWORD_RL = new FakeRateLimiter({ allow: 1 });
    const res = await POST(authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' }));
    expect(passwordKeys()[1]).toBe('auth_pw_email:a@b.test');
    expect(res.status).toBe(TOO_MANY);
    expect(authFor).not.toHaveBeenCalled();
  });

  it('marks the limiters critical so a missing binding fails closed in production', async () => {
    await POST(authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' }));
    expect(enforceRate).toHaveBeenCalledTimes(2);
    for (const call of enforceRate.mock.calls) {
      expect(call[3]).toMatchObject({ critical: true });
    }
  });

  it('fails closed in production when the AUTH_PASSWORD_RL binding is missing', async () => {
    const { error } = mockConsole('error');
    const e = authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' });
    delete (e.platform!.env as unknown as Record<string, unknown>).AUTH_PASSWORD_RL;
    const res = await POST(e);
    expect(res.status).toBe(TOO_MANY);
    expect(authFor).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0][0])).toContain('label=auth_pw_ip');
  });

  it('still limits per-IP, and passes through, when the body has no email', async () => {
    const res = await POST(authEvent('POST', SIGN_IN_EMAIL, { password: 'x' }));
    expect(limiterCalls()).toBe(1);
    expect(res.status).toBe(200);
  });

  it('leaves the request body readable by Better-Auth after the email peek', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('ok'));
    authFor.mockReturnValue({ handler });
    await POST(authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' }));
    const forwarded = handler.mock.calls[0][0] as Request;
    await expect(forwarded.json()).resolves.toMatchObject({ email: 'a@b.test' });
  });

  it('does not rate-limit unrelated auth routes', async () => {
    await POST(authEvent('POST', '/api/auth/sign-in/social', { provider: 'google' }));
    expect(limiterCalls()).toBe(0);
  });
});

/** Reset requests share the AUTH_LINK_RL rate limit. */
describe('raw password-reset rate limiting', () => {
  it('limits the reset endpoint on the AUTH_LINK_RL binding, both dimensions', async () => {
    await POST(authEvent('POST', RESET, { email: 'a@b.test' }));
    expect(linkKeys()).toHaveLength(2);
    expect(passwordKeys()).toHaveLength(0);
    expect(linkKeys().some((k) => k.startsWith('auth_link_ip:'))).toBe(true);
    expect(linkKeys()).toContain('auth_link_email:a@b.test');
  });

  it('429s WITHOUT reaching Better-Auth when limited (no reset email is sent)', async () => {
    AUTH_LINK_RL = new FakeRateLimiter({ allow: 0 });
    const res = await POST(authEvent('POST', RESET, { email: 'a@b.test' }));
    expect(res.status).toBe(TOO_MANY);
    expect(authFor).not.toHaveBeenCalled();
  });

  it('buckets a known and an unknown address identically (no enumeration oracle)', async () => {
    // The bucket is keyed on what the caller TYPED, so the 429 says nothing about
    // whether the account exists — only that this address was tried too often.
    await POST(authEvent('POST', RESET, { email: 'KNOWN@b.test' }));
    const known = [...linkKeys()];
    AUTH_LINK_RL = new FakeRateLimiter({ allow: 100 });
    await POST(authEvent('POST', RESET, { email: 'unknown@b.test' }));
    const unknown = [...linkKeys()];
    expect(known).toHaveLength(unknown.length);
    expect(known).toContain('auth_link_email:known@b.test');
    expect(unknown).toContain('auth_link_email:unknown@b.test');
  });
});

/**
 * The always-on paths that send mail share AUTH_LINK_RL with the `/signin` form and the
 * account email routes, so posting to Better-Auth directly gets no second allowance.
 */
describe('raw mail-sending rate limiting', () => {
  const MAGIC = '/api/auth/sign-in/magic-link';
  const VERIFY = '/api/auth/send-verification-email';
  const CHANGE = '/api/auth/change-email';

  it.each([
    [MAGIC, { email: 'A@b.test' }],
    [VERIFY, { email: 'A@b.test' }],
    [CHANGE, { newEmail: 'A@b.test' }]
  ])('limits %s on AUTH_LINK_RL by IP and by email, critical', async (path, body) => {
    await POST(authEvent('POST', path, body));
    expect(passwordKeys()).toHaveLength(0);
    expect(linkKeys()).toHaveLength(2);
    expect(linkKeys().some((k) => k.startsWith('auth_link_ip:'))).toBe(true);
    expect(linkKeys()).toContain('auth_link_email:a@b.test');
    expect(enforceRate).toHaveBeenCalledWith(
      AUTH_LINK_RL,
      'auth_link_email:a@b.test',
      expect.anything(),
      expect.objectContaining({ critical: true })
    );
    expect(authHandler).toHaveBeenCalled();
  });

  it.each([MAGIC, VERIFY, CHANGE])('429s %s WITHOUT reaching Better-Auth', async (path) => {
    AUTH_LINK_RL = new FakeRateLimiter({ allow: 0 });
    const res = await POST(authEvent('POST', path, { email: 'a@b.test', newEmail: 'a@b.test' }));
    expect(res.status).toBe(TOO_MANY);
    expect(authFor).not.toHaveBeenCalled();
  });

  it('limits by IP alone when the body carries no email', async () => {
    await POST(authEvent('POST', MAGIC, {}));
    expect(linkKeys()).toHaveLength(1);
    expect(linkKeys()[0]).toMatch(/^auth_link_ip:/);
  });

  it('fails closed in production when the AUTH_LINK_RL binding is missing', async () => {
    mockConsole('error');
    const e = authEvent('POST', MAGIC, { email: 'a@b.test' });
    (e.platform!.env as unknown as Record<string, unknown>).AUTH_LINK_RL = undefined;
    const res = await POST(e);
    expect(res.status).toBe(TOO_MANY);
    expect(authFor).not.toHaveBeenCalled();
  });
});

/**
 * `POST /api/auth/reset-password` is the submit half (`{ token, newPassword }`, no email),
 * so only the per-IP dimension applies — and it shares the AUTH_PASSWORD_RL budget with
 * password sign-in rather than getting a second allowance.
 */
describe('raw password-reset-submit rate limiting', () => {
  it('is rate limited per IP', async () => {
    expect.hasAssertions();
    AUTH_PASSWORD_RL = new FakeRateLimiter({ allow: 0 });
    const res = await POST(
      authEvent('POST', RESET_PASSWORD, { token: 't', newPassword: 'whatever-long-enough' })
    );
    expect(res.status).toBe(TOO_MANY);
    expect(passwordKeys()).toHaveLength(1);
    expect(enforceRate).toHaveBeenCalledWith(
      AUTH_PASSWORD_RL,
      expect.stringMatching(/^auth_pw_ip:/),
      expect.anything(),
      expect.objectContaining({ critical: true })
    );
  });

  it('reaches Better-Auth when under the limit', async () => {
    expect.hasAssertions();
    const res = await POST(
      authEvent('POST', RESET_PASSWORD, { token: 't', newPassword: 'whatever-long-enough' })
    );
    expect(res.status).not.toBe(TOO_MANY);
    expect(authHandler).toHaveBeenCalled();
  });
});

/**
 * A disabled sign-in method's Better-Auth paths answer 404 before any limiter or Better-Auth
 * call. Better-Auth's own handlers are not a sufficient gate: `/reset-password`,
 * `/change-password` and `/verify-password` check no configuration.
 */
describe('disabled sign-in methods', () => {
  const DEFAULTS = {}; // no AUTH_METHODS: magic link only
  const PASSWORD = [
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
    '/api/auth/reset-password/tok123',
    '/api/auth/change-password',
    '/api/auth/verify-password'
  ];
  const PASSKEY = [
    '/api/auth/passkey/generate-register-options',
    '/api/auth/passkey/generate-authenticate-options',
    '/api/auth/passkey/verify-registration',
    '/api/auth/passkey/verify-authentication',
    '/api/auth/passkey/list-user-passkeys',
    '/api/auth/passkey/delete-passkey',
    '/api/auth/passkey/update-passkey'
  ];
  const GOOGLE = ['/api/auth/sign-in/social', '/api/auth/link-social', '/api/auth/callback/google'];

  const expect404 = async (method: 'GET' | 'POST', path: string, env: Record<string, unknown>) => {
    const fn = method === 'GET' ? GET : POST;
    const res = await fn(authEvent(method, path, method === 'POST' ? {} : undefined, env));
    expect(res.status, `${method} ${path}`).toBe(404);
  };

  it.each([...PASSWORD, ...PASSKEY, ...GOOGLE])(
    'with the default methods, %s answers 404 to GET and POST',
    async (path) => {
      await expect404('GET', path, DEFAULTS);
      await expect404('POST', path, DEFAULTS);
      await expect404('POST', `${path}/`, DEFAULTS);
      await expect404('POST', path.toUpperCase().replace('/API/AUTH', '/api/auth'), DEFAULTS);
      expect(limiterCalls()).toBe(0);
      expect(authFor).not.toHaveBeenCalled();
    }
  );

  it('answers the four named paths 404 before any limiter call', async () => {
    const r1 = await POST(
      authEvent('POST', SIGN_IN_EMAIL, { email: 'a@b.test', password: 'x' }, DEFAULTS)
    );
    const r2 = await POST(authEvent('POST', RESET, { email: 'a@b.test' }, DEFAULTS));
    const r3 = await GET(
      authEvent('GET', '/api/auth/passkey/generate-register-options', undefined, DEFAULTS)
    );
    const r4 = await GET(authEvent('GET', '/api/auth/callback/google', undefined, DEFAULTS));
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([404, 404, 404, 404]);
    expect(limiterCalls()).toBe(0);
    expect(authFor).not.toHaveBeenCalled();
  });

  it("with AUTH_METHODS 'password' the sign-in path reaches the limiter", async () => {
    const res = await POST(
      authEvent(
        'POST',
        SIGN_IN_EMAIL,
        { email: 'a@b.test', password: 'x' },
        { AUTH_METHODS: 'password' }
      )
    );
    expect(res.status).toBe(200);
    expect(passwordKeys()).toHaveLength(2);
    expect(authHandler).toHaveBeenCalled();
  });

  it('closes only the methods left off', async () => {
    const env = { AUTH_METHODS: 'password' };
    await expect404('GET', '/api/auth/passkey/generate-register-options', env);
    await expect404('GET', '/api/auth/callback/google', env);
    const res = await POST(authEvent('POST', '/api/auth/change-password', {}, env));
    expect(res.status).toBe(200);
  });

  it('keeps Google closed when it is listed but has no credentials', async () => {
    await expect404('POST', '/api/auth/sign-in/social', { AUTH_METHODS: 'google' });
  });

  it('keeps the magic-link and session paths open while mail can be delivered', async () => {
    for (const path of [
      '/api/auth/sign-in/magic-link',
      '/api/auth/send-verification-email',
      '/api/auth/change-email',
      '/api/auth/verify-email',
      '/api/auth/magic-link/verify',
      '/api/auth/get-session',
      '/api/auth/sign-out'
    ]) {
      const res = await POST(authEvent('POST', path, {}, DEFAULTS));
      expect(res.status, path).toBe(200);
    }
    expect(authHandler).toHaveBeenCalledTimes(7);
  });

  it('closes every path that sends mail when no mail provider is configured', async () => {
    for (const path of [
      '/api/auth/sign-in/magic-link',
      '/api/auth/send-verification-email',
      '/api/auth/change-email',
      '/api/auth/verify-email'
    ]) {
      await expect404('POST', path, NO_MAIL);
      await expect404('GET', path, NO_MAIL);
    }
    expect(limiterCalls()).toBe(0);
    expect(authFor).not.toHaveBeenCalled();
  });

  it('keeps the session paths and the link verify open with no mail provider', async () => {
    for (const path of [
      '/api/auth/magic-link/verify',
      '/api/auth/get-session',
      '/api/auth/sign-out'
    ]) {
      const res = await POST(authEvent('POST', path, {}, NO_MAIL));
      expect(res.status, path).toBe(200);
    }
  });
});
