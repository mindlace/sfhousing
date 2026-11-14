import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { SIMS_COPY } from '$lib/members/copy';
import type { UpdateProfileResult } from '$lib/server/user-store/profile';
import { PATCH } from './+server';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));

const { enforceRate, updateProfile } = vi.hoisted(() => ({
  enforceRate: vi.fn(async (): Promise<boolean> => true),
  updateProfile: vi.fn(async (): Promise<UpdateProfileResult> => ({
    ok: true,
    handleChanged: true,
    oldHandleFreesAt: null,
    handle: 'ada2',
    name: 'Ada'
  }))
}));

vi.mock('$lib/server/security/rate-limit', () => ({ enforceRate }));
vi.mock('$lib/server/user-store/profile', () => ({ updateProfile }));

const platform = { env: { ACCOUNT_EDIT_RL: {} } } as unknown as App.Platform;
function evt(
  bodyObj: unknown,
  over: Record<string, unknown> = {},
  headers: Record<string, string> = { 'content-type': 'application/json' }
) {
  return {
    locals: { user: { id: 'u1', handle: 'ada' } },
    platform,
    url: new URL('http://localhost/api/account/profile'),
    getClientAddress: () => '1.2.3.4',
    request: new Request('http://localhost/api/account/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(bodyObj)
    }),
    ...over
  } as unknown as Parameters<typeof PATCH>[0];
}

describe('PATCH /api/account/profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 on success', async () => {
    const res = await PATCH(evt({ handle: 'ada2', name: 'Ada' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.handle).toBe('ada2');
    expect(body.name).toBe('Ada');
  });

  it('400 with reason on failure', async () => {
    updateProfile.mockResolvedValueOnce({ ok: false, reason: 'already taken' });
    const res = await PATCH(evt({ handle: 'taken' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('already taken');
  });

  it('429 when rate-limited', async () => {
    enforceRate.mockResolvedValueOnce(false);
    const res = await PATCH(evt({ name: 'Ada' }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe(ACCOUNT_COPY.tooManyChanges);
  });

  it('401 when not signed in', async () => {
    const res = await PATCH(evt({ name: 'Ada' }, { locals: { user: null } }));
    expect(res.status).toBe(401);
  });

  it('415 and no write when the body is not JSON', async () => {
    const res = await PATCH(evt({ name: 'Ada' }, {}, { 'content-type': 'text/plain' }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('403 and no write for a foreign Origin', async () => {
    const res = await PATCH(
      evt(
        { name: 'Ada' },
        {},
        { 'content-type': 'application/json', origin: 'https://evil.example' }
      )
    );
    expect(res.status).toBe(403);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
