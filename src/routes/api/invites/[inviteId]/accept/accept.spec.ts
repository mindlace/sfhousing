import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MEMBERS_COPY } from '$lib/members/copy';

const { acceptInviteById, onSimRosterChanged } = vi.hoisted(() => ({
  acceptInviteById: vi.fn(),
  onSimRosterChanged: vi.fn(async () => {})
}));

vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('$lib/server/invites/control-plane', () => ({ acceptInviteById }));
vi.mock('$lib/server/sims/roster-hook', () => ({ onSimRosterChanged }));

import { POST } from './+server';

const USER = { id: 'u1', email: 'u1@test.com', emailVerified: true };
/** The request's platform: the hook must receive its env as given. */
const platform = { env: { marker: 'env' } };

function acceptEvent(opts: { user?: typeof USER | null; headers?: Record<string, string> } = {}) {
  return {
    params: { inviteId: 'inv1' },
    platform,
    url: new URL('http://x/api/invites/inv1/accept'),
    locals: { user: opts.user === undefined ? USER : opts.user },
    request: new Request('http://x/api/invites/inv1/accept', {
      method: 'POST',
      headers: opts.headers ?? { 'content-type': 'application/json' }
    })
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/invites/:inviteId/accept', () => {
  it('accepts, calls the roster hook with the env and sim id and answers { simId }', async () => {
    expect.hasAssertions();
    acceptInviteById.mockResolvedValue({ simId: 'sim1' });
    const res = await POST(acceptEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ simId: 'sim1' });
    expect(acceptInviteById).toHaveBeenCalledWith({
      db: {},
      inviteId: 'inv1',
      userId: 'u1',
      email: 'u1@test.com',
      emailVerified: true
    });
    expect(onSimRosterChanged).toHaveBeenCalledTimes(1);
    expect(onSimRosterChanged).toHaveBeenCalledWith(platform.env, 'sim1');
  });

  it('answers 400 with a code, not the message, and does not call the roster hook when accept fails', async () => {
    expect.hasAssertions();
    acceptInviteById.mockRejectedValue(new Error('invite expired'));
    const res = await POST(acceptEvent());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invite_invalid' });
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });

  it('answers 401 for a signed-out caller', async () => {
    expect.hasAssertions();
    await expect(POST(acceptEvent({ user: null }))).rejects.toMatchObject({
      status: 401,
      body: { message: MEMBERS_COPY.notSignedIn }
    });
    expect(acceptInviteById).not.toHaveBeenCalled();
  });

  it('415s a request that is not application/json, before doing anything', async () => {
    expect.hasAssertions();
    const res = await POST(acceptEvent({ headers: {} }));
    expect(res.status).toBe(415);
    expect(acceptInviteById).not.toHaveBeenCalled();
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });

  it('403s a foreign Origin, before doing anything', async () => {
    expect.hasAssertions();
    const res = await POST(
      acceptEvent({
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' }
      })
    );
    expect(res.status).toBe(403);
    expect(acceptInviteById).not.toHaveBeenCalled();
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });
});
