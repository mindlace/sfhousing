import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SIMS_COPY } from '$lib/members/copy';
import { mockConsole } from '$lib/server/test/mock-console';

const { requireSimRole, removeSimMember } = vi.hoisted(() => ({
  requireSimRole: vi.fn(),
  removeSimMember: vi.fn()
}));

vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole }));
vi.mock('$lib/server/sims/sims', () => ({ removeSimMember }));
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));

import { DELETE } from './+server';

/** The request's platform: removeSimMember must receive its env as given. */
const platform = { env: { marker: 'env' } };

function deleteEvent(
  simId: string,
  userId: string,
  headers: Record<string, string> = { 'content-type': 'application/json' }
) {
  return {
    params: { simId, userId },
    platform,
    locals: { user: { id: 'manager-1', email: 'manager@test.com' } },
    url: new URL(`http://x/api/sims/${simId}/members/${userId}`),
    request: new Request(`http://x/api/sims/${simId}/members/${userId}`, {
      method: 'DELETE',
      headers
    })
  } as unknown as Parameters<typeof DELETE>[0];
}

async function httpStatus(fn: () => unknown): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSimRole.mockResolvedValue({
    role: 'manager',
    actor: { actorId: 'manager-1', actorKind: 'human' }
  });
});

describe('DELETE /api/sims/:simId/members/:userId', () => {
  it('authorizes as manager before mutating', async () => {
    removeSimMember.mockResolvedValue({ deleted: false });
    await DELETE(deleteEvent('s1', 'u2'));
    expect(requireSimRole).toHaveBeenCalledWith(expect.anything(), 's1', 'manager');
  });

  it('propagates the authz error from requireSimRole (no swallow)', async () => {
    requireSimRole.mockRejectedValue({ status: 403, body: { message: 'insufficient role' } });
    const status = await httpStatus(() => DELETE(deleteEvent('s1', 'u2')));
    expect(status).toBe(403);
    expect(removeSimMember).not.toHaveBeenCalled();
  });

  it('204 on the happy path, calling removeSimMember with the path params and the acting id', async () => {
    removeSimMember.mockResolvedValue({ deleted: false });
    const res = await DELETE(deleteEvent('s1', 'u2'));
    expect(res.status).toBe(204);
    expect(removeSimMember).toHaveBeenCalledWith({
      db: {},
      env: platform.env,
      simId: 's1',
      userId: 'u2',
      // The route opts into co-manager protection by passing the acting id.
      actorUserId: 'manager-1'
    });
  });

  it('400 with a code, not the message, when removeSimMember refuses', async () => {
    removeSimMember.mockRejectedValue(
      new Error('cannot remove another manager; they must leave the sim themselves')
    );
    const res = await DELETE(deleteEvent('s1', 'manager-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'manager_protected' });
  });

  it('400 with the generic code, and no server text, for an unexpected error', async () => {
    const { error: errSpy } = mockConsole('error');
    removeSimMember.mockRejectedValue(new Error('D1_ERROR: database is locked'));
    const res = await DELETE(deleteEvent('s1', 'manager-1'));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: 'failed' });
    expect(text).not.toContain('D1');
    expect(errSpy).toHaveBeenCalled();
  });

  it('415 when the request is not JSON, before any authz or write', async () => {
    const res = await DELETE(deleteEvent('s1', 'u2', {}));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(removeSimMember).not.toHaveBeenCalled();
  });

  it('403 for a foreign Origin, before any authz or write', async () => {
    const res = await DELETE(
      deleteEvent('s1', 'u2', {
        'content-type': 'application/json',
        origin: 'https://evil.example'
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.crossOrigin });
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(removeSimMember).not.toHaveBeenCalled();
  });
});
