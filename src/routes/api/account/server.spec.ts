import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { SIMS_COPY } from '$lib/members/copy';
import { GET, DELETE } from './+server';

const { deleteAccount, signOut } = vi.hoisted(() => ({
  deleteAccount: vi.fn(async (_args: unknown) => ({ more: false })),
  signOut: vi.fn(async () => {})
}));

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/user-store/oauth', () => ({ userHasOAuthAccount: vi.fn(async () => true) }));
vi.mock('$lib/server/user-store/deletion', () => ({ deleteAccount }));
vi.mock('$lib/server/user-store/password-credential', () => ({
  hasPassword: vi.fn(async () => true),
  mayRemovePassword: vi.fn(async () => false)
}));
vi.mock('$lib/server/auth/better-auth', () => ({
  authFor: () => ({ api: { signOut } })
}));

const waitUntil = vi.fn();
const platform = { env: { marker: 'env' }, ctx: { waitUntil } } as unknown as App.Platform;
function evt(over: Record<string, unknown> = {}) {
  return {
    locals: { user: { id: 'u1', handle: 'ada', pseudonymous: false }, session: { userId: 'u1' } },
    platform,
    url: new URL('http://localhost/api/account'),
    request: new Request('http://localhost/api/account'),
    ...over
  } as unknown as Parameters<typeof GET>[0];
}

function del(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/account', () => {
  it('401 when signed out', async () => {
    const res = await GET(evt({ locals: { user: null, session: null } }));
    expect(res.status).toBe(401);
  });

  // The ported GET also returned the subscription, the unit and credit balances and the
  // credit presets (billing and Money); sfhousing has none of them, so the body is exactly
  // the four account facts.
  it('returns exactly the four account facts', async () => {
    const res = await GET(evt());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hasGoogle: true,
      hasPassword: true,
      canRemovePassword: false,
      pseudonymous: false
    });
  });

  it('surfaces pseudonymous: true for a pseudonymous user', async () => {
    const res = await GET(
      evt({
        locals: {
          user: { id: 'u1', handle: 'ada', pseudonymous: true },
          session: { userId: 'u1' }
        }
      })
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pseudonymous).toBe(true);
  });
});

describe('DELETE /api/account', () => {
  it('400 on handle mismatch', async () => {
    const res = await DELETE(evt({ request: del({ confirmHandle: 'wrong' }) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).deleteError).toBe(
      ACCOUNT_COPY.handleMismatch
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('401 when signed out', async () => {
    const res = await DELETE(
      evt({ locals: { user: null, session: null }, request: del({ confirmHandle: 'ada' }) })
    );
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('200 + deletes on match, as the human actor, then signs out', async () => {
    const res = await DELETE(evt({ request: del({ confirmHandle: 'ada' }) }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).ok).toBe(true);
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(deleteAccount).toHaveBeenCalledWith({
      db: {},
      env: platform.env,
      identityId: 'u1',
      actor: { actorId: 'u1', actorKind: 'human' },
      defer: expect.any(Function)
    });
    // The fan-out over the sims it left runs after the response, through waitUntil.
    const { defer } = deleteAccount.mock.calls[0][0] as { defer: (p: Promise<void>) => void };
    const work = Promise.resolve();
    defer(work);
    expect(waitUntil).toHaveBeenCalledWith(work);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('202 { more: true } while passes remain, without signing out', async () => {
    deleteAccount.mockResolvedValueOnce({ more: true });
    const res = await DELETE(evt({ request: del({ confirmHandle: 'ada' }) }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ more: true });
    expect(deleteAccount).toHaveBeenCalledWith({
      db: {},
      env: platform.env,
      identityId: 'u1',
      actor: { actorId: 'u1', actorKind: 'human' },
      defer: expect.any(Function)
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('still answers 200 when the sign-out has nothing left to sign out', async () => {
    signOut.mockRejectedValueOnce(new Error('no session'));
    const res = await DELETE(evt({ request: del({ confirmHandle: 'ada' }) }));
    expect(res.status).toBe(200);
  });

  it('415 and no deletion when the body is not JSON', async () => {
    const request = new Request('http://localhost/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ confirmHandle: 'ada' })
    });
    const res = await DELETE(evt({ request }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('403 and no deletion for a foreign Origin', async () => {
    const res = await DELETE(
      evt({ request: del({ confirmHandle: 'ada' }, { origin: 'https://evil.example' }) })
    );
    expect(res.status).toBe(403);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
