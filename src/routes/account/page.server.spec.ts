import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { E2E_AUTH_METHODS_COOKIE } from '$lib/server/auth/methods';

const { hasPasskey, hasOAuth } = vi.hoisted(() => ({
  hasPasskey: vi.fn(async (_db: unknown, _id: string) => false),
  hasOAuth: vi.fn(async (_db: unknown, _id: string) => false)
}));

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/user-store/passkey', () => ({ userHasPasskey: hasPasskey }));
vi.mock('$lib/server/user-store/oauth', () => ({ userHasOAuthAccount: hasOAuth }));

import { load } from './+page.server';

const user = {
  id: 'u1',
  handle: 'ada',
  name: 'Ada',
  email: 'ada@x.com',
  image: null,
  emailVerified: true,
  pseudonymous: false
};

function evt(over: Record<string, unknown> = {}, authMethods?: string) {
  return {
    locals: { user, session: { id: 's1', userId: 'u1-live' } },
    platform: { env: { AUTH_METHODS: authMethods } },
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
      user: { id: 'u1', handle: 'ada', name: 'Ada', email: 'ada@x.com', pseudonymous: false },
      methods: ['magic-link'],
      hasPasskey: true,
      hasOAuthAccount: true
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

  it('never returns the image or the emailVerified flag', async () => {
    const data = (await load(evt())) as { user: Record<string, unknown> };
    expect(Object.keys(data.user).sort()).toEqual([
      'email',
      'handle',
      'id',
      'name',
      'pseudonymous'
    ]);
  });
});
