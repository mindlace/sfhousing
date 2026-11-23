import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { AUTH_COPY } from '$lib/account/copy';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { mintPseudonymousSession } from './pseudonymous-mint';

/** Minimal RequestEvent stand-in with a permissive mint limiter. */
function fakeEvent(
  env: Record<string, unknown> = { PSEUDO_MINT_RL: new FakeRateLimiter({ allow: 100 }) }
): RequestEvent {
  return {
    request: new Request('http://localhost/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
    url: new URL('http://localhost/'),
    platform: { env, cf: undefined, ctx: undefined, caches: undefined },
    cookies: {},
    locals: {},
    route: { id: null }
  } as unknown as RequestEvent;
}

describe('mintPseudonymousSession', () => {
  it('answers 500 with AUTH_COPY.sessionStart when the auth API yields no user', async () => {
    const res = await mintPseudonymousSession(fakeEvent(), {
      signIn: async () => null,
      resolve: async () => null
    });
    expect(res).toEqual({ ok: false, status: 500, message: AUTH_COPY.sessionStart });
  });

  it('returns ok:false 500 when sign-in succeeds but the live user cannot be resolved', async () => {
    const res = await mintPseudonymousSession(fakeEvent(), {
      signIn: async () => ({ user: { id: 'live-1' } }),
      resolve: async () => null
    });
    expect(res).toMatchObject({ ok: false, status: 500 });
  });

  it('returns the resolved user on success', async () => {
    const u = { id: 'ident-1', pseudonymous: true } as never;
    const res = await mintPseudonymousSession(fakeEvent(), {
      signIn: async () => ({ user: { id: 'live-1' } }),
      resolve: async () => u
    });
    expect(res).toMatchObject({ ok: true, user: { id: 'ident-1' } });
  });

  it('answers 429 with AUTH_COPY.tooManyAccounts when the mint limiter denies', async () => {
    const limiter = new FakeRateLimiter({ allow: 0 });
    let signedIn = false;
    const res = await mintPseudonymousSession(fakeEvent({ PSEUDO_MINT_RL: limiter }), {
      signIn: async () => {
        signedIn = true;
        return null;
      }
    });
    expect(res).toEqual({ ok: false, status: 429, message: AUTH_COPY.tooManyAccounts });
    expect(limiter.calls).toEqual(['pseudo_mint:1.2.3.4']);
    expect(signedIn).toBe(false);
  });

  it('words the four texts that left the members copy', () => {
    expect(AUTH_COPY.tooManyAccounts).toBe('Too many new accounts too quickly. Wait a moment.');
    expect(AUTH_COPY.sessionStart).toBe("Couldn't start your session. Try again.");
    expect(AUTH_COPY.jsonRequired).toBe('Send JSON.');
    expect(AUTH_COPY.crossOrigin).toBe('Cross-site requests are not allowed.');
  });
});
