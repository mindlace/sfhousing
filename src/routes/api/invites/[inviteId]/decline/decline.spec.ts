import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MEMBERS_COPY } from '$lib/members/copy';

const { declineInvite, onSimRosterChanged } = vi.hoisted(() => ({
  declineInvite: vi.fn(),
  onSimRosterChanged: vi.fn(async () => {})
}));

vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('$lib/server/invites/control-plane', () => ({ declineInvite }));
vi.mock('$lib/server/sims/roster-hook', () => ({ onSimRosterChanged }));

import { POST } from './+server';

function declineEvent(
  opts: { user?: { id: string } | null; headers?: Record<string, string> } = {}
) {
  return {
    params: { inviteId: 'inv1' },
    platform: { env: {} },
    url: new URL('http://x/api/invites/inv1/decline'),
    locals: { user: opts.user === undefined ? { id: 'u1' } : opts.user },
    request: new Request('http://x/api/invites/inv1/decline', {
      method: 'POST',
      headers: opts.headers ?? { 'content-type': 'application/json' }
    })
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/invites/:inviteId/decline', () => {
  it('declines and answers 204; the roster is unchanged so the hook is not called', async () => {
    expect.hasAssertions();
    const res = await POST(declineEvent());
    expect(res.status).toBe(204);
    expect(declineInvite).toHaveBeenCalledWith({ db: {}, inviteId: 'inv1', userId: 'u1' });
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });

  it('answers 401 for a signed-out caller', async () => {
    expect.hasAssertions();
    await expect(POST(declineEvent({ user: null }))).rejects.toMatchObject({
      status: 401,
      body: { message: MEMBERS_COPY.notSignedIn }
    });
    expect(declineInvite).not.toHaveBeenCalled();
  });

  it('415s a request that is not application/json, before doing anything', async () => {
    expect.hasAssertions();
    const res = await POST(declineEvent({ headers: {} }));
    expect(res.status).toBe(415);
    expect(declineInvite).not.toHaveBeenCalled();
  });

  it('403s a foreign Origin, before doing anything', async () => {
    expect.hasAssertions();
    const res = await POST(
      declineEvent({
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' }
      })
    );
    expect(res.status).toBe(403);
    expect(declineInvite).not.toHaveBeenCalled();
  });
});
