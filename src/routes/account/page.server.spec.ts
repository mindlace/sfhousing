import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { E2E_AUTH_METHODS_COOKIE } from '$lib/server/auth/methods';

const { hasPasskey, hasOAuth, signOut, authFor } = vi.hoisted(() => {
  const signOut = vi.fn(async (_args: unknown) => ({ success: true }));
  return {
    hasPasskey: vi.fn(async (_db: unknown, _id: string) => false),
    hasOAuth: vi.fn(async (_db: unknown, _id: string) => false),
    signOut,
    authFor: vi.fn((_event: unknown) => ({ api: { signOut } }))
  };
});

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/user-store/passkey', () => ({ userHasPasskey: hasPasskey }));
vi.mock('$lib/server/user-store/oauth', () => ({ userHasOAuthAccount: hasOAuth }));
vi.mock('$lib/server/auth/better-auth', () => ({ authFor }));

import { actions, load } from './+page.server';
import { KNOWN_DEVICE_COOKIE } from '$lib/server/onboarding/known-device';

const user = {
  id: 'u1',
  handle: 'ada',
  name: 'Ada',
  email: 'ada@x.com',
  image: null,
  emailVerified: true,
  pseudonymous: false
};

/** SES keys: a mail provider is configured, so magic link is in effect. */
const MAIL = { SES_ACCESS_KEY_ID: 'key-id', SES_SECRET_ACCESS_KEY: 'secret' };

function evt(over: Record<string, unknown> = {}, authMethods?: string) {
  return {
    locals: { user, session: { id: 's1', userId: 'u1-live' } },
    platform: { env: { ...MAIL, AUTH_METHODS: authMethods } },
    url: new URL('https://app.test/account'),
    cookies: { get: () => undefined },
    ...over
  } as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPasskey.mockResolvedValue(false);
  hasOAuth.mockResolvedValue(false);
});

describe('/account load', () => {
  it('redirects a signed-out visitor to /signin with returnTo=/account', async () => {
    expect.assertions(3);
    try {
      await load(evt({ locals: { user: null, session: null } }));
    } catch (err) {
      expect(isRedirect(err)).toBe(true);
      expect((err as { status: number }).status).toBe(303);
      expect((err as { location: string }).location).toBe('/signin?returnTo=/account');
    }
  });

  it('returns the user, the methods, hasPasskey and hasOAuthAccount', async () => {
    hasPasskey.mockResolvedValue(true);
    hasOAuth.mockResolvedValue(true);
    const data = await load(evt());
    expect(data).toEqual({
      user: {
        id: 'u1',
        handle: 'ada',
        name: 'Ada',
        email: 'ada@x.com',
        emailVerified: true,
        pseudonymous: false
      },
      methods: ['magic-link'],
      hasPasskey: true,
      hasOAuthAccount: true,
      linkError: false
    });
  });

  it('asks the stores about the LIVE user row, not the identity id', async () => {
    await load(evt());
    expect(hasPasskey).toHaveBeenCalledWith(expect.anything(), 'u1-live');
    expect(hasOAuth).toHaveBeenCalledWith(expect.anything(), 'u1-live');
  });

  it('offers only magic-link by default', async () => {
    const data = (await load(evt())) as { methods: string[] };
    expect(data.methods).toEqual(['magic-link']);
  });

  it('offers no method when no mail provider is configured', async () => {
    const data = (await load(evt({ platform: { env: {} } }))) as { methods: string[] };
    expect(data.methods).toEqual([]);
  });

  it('lists a method AUTH_METHODS switches on', async () => {
    const data = (await load(evt({}, 'password,passkey'))) as { methods: string[] };
    expect(data.methods).toEqual(['magic-link', 'password', 'passkey']);
  });

  it('leaves out Google without its credentials, even when listed', async () => {
    const data = (await load(evt({}, 'google'))) as { methods: string[] };
    expect(data.methods).toEqual(['magic-link']);
  });

  it('does not take methods from the e2e cookie outside an e2e build', async () => {
    const cookies = {
      get: (n: string) => (n === E2E_AUTH_METHODS_COOKIE ? 'password' : undefined)
    };
    const data = (await load(evt({ cookies }))) as { methods: string[] };
    expect(data.methods).toEqual(['magic-link']);
  });

  it('returns the emailVerified flag, so the page claims a confirmed email only when it is', async () => {
    const data = (await load(
      evt({ locals: { user: { ...user, emailVerified: false }, session: { userId: 'u1-live' } } })
    )) as { user: Record<string, unknown> };
    expect(data.user.emailVerified).toBe(false);
  });

  it('never returns the image', async () => {
    const data = (await load(evt())) as { user: Record<string, unknown> };
    expect(Object.keys(data.user).sort()).toEqual([
      'email',
      'emailVerified',
      'handle',
      'id',
      'name',
      'pseudonymous'
    ]);
  });

  it('flags a confirm link that came back failed', async () => {
    const data = (await load(
      evt({ url: new URL('https://app.test/account?link=failed&error=INVALID_TOKEN') })
    )) as { linkError: boolean };
    expect(data.linkError).toBe(true);
  });
});

describe('/account signOut action', () => {
  function actionEvent(signedIn = true) {
    const cookies = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
    const request = new Request('https://app.test/account?/signOut', {
      method: 'POST',
      headers: { cookie: 'better-auth.session_token=abc' }
    });
    const event = {
      ...(evt(signedIn ? {} : { locals: { user: null, session: null } }) as object),
      request,
      cookies
    } as unknown as Parameters<typeof actions.signOut>[0];
    return { event, cookies, request };
  }

  async function redirectOf(run: () => unknown) {
    try {
      await run();
    } catch (e) {
      if (isRedirect(e)) return e;
      throw e;
    }
    throw new Error('expected a redirect');
  }

  it('signs the current session out through Better-Auth and lands on /', async () => {
    const { event, request } = actionEvent();
    const r = await redirectOf(() => actions.signOut(event));
    expect(r).toMatchObject({ status: 303, location: '/' });
    expect(authFor).toHaveBeenCalledWith(event);
    expect(signOut).toHaveBeenCalledWith({ headers: request.headers });
  });

  it('keeps the known-device cookie, so the next sim on this device steers to sign-in', async () => {
    const { event, cookies } = actionEvent();
    await redirectOf(() => actions.signOut(event));
    expect(cookies.delete).not.toHaveBeenCalledWith(KNOWN_DEVICE_COOKIE, expect.anything());
  });

  it('lands a visitor with no session on / without calling Better-Auth', async () => {
    const { event } = actionEvent(false);
    const r = await redirectOf(() => actions.signOut(event));
    expect(r).toMatchObject({ status: 303, location: '/' });
    expect(signOut).not.toHaveBeenCalled();
  });
});
