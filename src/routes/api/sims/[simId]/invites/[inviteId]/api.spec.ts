import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSimRole, revokeInvite } = vi.hoisted(() => ({
  requireSimRole: vi.fn(),
  revokeInvite: vi.fn()
}));

vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole }));
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('$lib/server/invites/control-plane', () => ({ revokeInvite }));

import { DELETE } from './+server';

function deleteEvent(headers: Record<string, string>) {
  return {
    params: { simId: 'q1', inviteId: 'inv1' },
    platform: { env: {} },
    url: new URL('http://x/api/sims/q1/invites/inv1'),
    locals: { user: { id: 'u1' } },
    request: new Request('http://x/api/sims/q1/invites/inv1', { method: 'DELETE', headers })
  } as unknown as Parameters<typeof DELETE>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSimRole.mockResolvedValue({ role: 'manager', actor: { actorId: 'u1' } });
});

describe('DELETE /api/sims/:simId/invites/:inviteId (revokes an invite)', () => {
  it('revokes as manager and answers 204', async () => {
    expect.hasAssertions();
    const res = await DELETE(deleteEvent({ 'content-type': 'application/json' }));
    expect(res.status).toBe(204);
    expect(requireSimRole).toHaveBeenCalledWith(expect.anything(), 'q1', 'manager');
    expect(revokeInvite).toHaveBeenCalledWith({ db: {}, simId: 'q1', inviteId: 'inv1' });
  });

  it('415s a request that is not application/json, before authorizing', async () => {
    expect.hasAssertions();
    const res = await DELETE(deleteEvent({}));
    expect(res.status).toBe(415);
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it('403s a foreign Origin, before authorizing', async () => {
    expect.hasAssertions();
    const res = await DELETE(
      deleteEvent({ 'content-type': 'application/json', origin: 'https://evil.example' })
    );
    expect(res.status).toBe(403);
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it('propagates the authz error (no swallow)', async () => {
    expect.hasAssertions();
    requireSimRole.mockRejectedValue({ status: 403 });
    await expect(DELETE(deleteEvent({ 'content-type': 'application/json' }))).rejects.toEqual({
      status: 403
    });
    expect(revokeInvite).not.toHaveBeenCalled();
  });
});
