import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';

const {
  requireSimRole,
  createInvite,
  getManagerPendingInvite,
  sendInviteEmail,
  getUser,
  getDb,
  enforceRate,
  enforceMutationRate
} = vi.hoisted(() => {
  const makeDb = () => ({});
  return {
    requireSimRole: vi.fn(),
    createInvite: vi.fn(),
    getManagerPendingInvite: vi.fn(),
    sendInviteEmail: vi.fn(),
    getUser: vi.fn(),
    getDb: vi.fn(makeDb),
    enforceRate: vi.fn(),
    enforceMutationRate: vi.fn()
  };
});

vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole }));
vi.mock('$lib/server/db', () => ({ getDb }));
vi.mock('$lib/server/security/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/security/rate-limit')>();
  return { ...actual, enforceRate, enforceMutationRate };
});
vi.mock('$lib/server/invites/email', () => ({ sendInviteEmail }));
vi.mock('$lib/server/user-store/user', () => ({ getUser }));
vi.mock('$lib/server/invites/control-plane', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/invites/control-plane')>(
    '$lib/server/invites/control-plane'
  );
  return { ...actual, createInvite, getManagerPendingInvite };
});

import { POST } from './+server';

function postEvent(simId: string, body: unknown) {
  return {
    params: { simId },
    platform: { env: { INVITE_RL: {} } },
    url: new URL(`http://x/api/sims/${simId}/invites`),
    locals: { user: { id: 'u1', email: 'u1@test.com' } },
    request: new Request(`http://x/api/sims/${simId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as unknown as Parameters<typeof POST>[0];
}

async function httpStatus(fn: () => unknown): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

const verifiedInviter = {
  id: 'u1',
  handle: 'alice',
  email: 'u1@test.com',
  emailVerified: true
};

beforeEach(() => {
  vi.clearAllMocks();
  // The email-send-failure path logs via console.error; silence it so the
  // passing test doesn't trip signoff's stderr policer.
  mockConsole('error');
  requireSimRole.mockResolvedValue({
    role: 'manager',
    actor: { actorId: 'u1', actorKind: 'human' }
  });
  enforceRate.mockResolvedValue(true);
  enforceMutationRate.mockResolvedValue(undefined);
  getUser.mockResolvedValue(verifiedInviter);
  // Default: no richer row available, so the endpoint falls back to the request target —
  // individual tests override this when they care about the local-apply payload shape.
  getManagerPendingInvite.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/sims/:simId/invites (creates an invite)', () => {
  it('429s when the IP velocity limit is exceeded; no DB work, no email', async () => {
    expect.hasAssertions();
    // first call is the IP key
    enforceMutationRate.mockRejectedValueOnce({
      status: 429,
      body: { message: 'Too many invites from your network. Please wait a moment.' }
    });
    const status = await httpStatus(() => POST(postEvent('q1', { target: 'u2@test.com' })));
    expect(status).toBe(429);
    expect(createInvite).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('429s when the identity velocity limit is exceeded (IP ok)', async () => {
    expect.hasAssertions();
    // IP ok, identity over
    enforceMutationRate.mockResolvedValueOnce(undefined).mockRejectedValueOnce({
      status: 429,
      body: { message: 'Too many invites too quickly. Please slow down.' }
    });
    const status = await httpStatus(() => POST(postEvent('q1', { target: 'u2@test.com' })));
    expect(status).toBe(429);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('authorizes as manager before mutating', async () => {
    expect.hasAssertions();
    createInvite.mockResolvedValue({
      invite: { id: 'inv1', invitedEmail: null },
      resolvedUser: null
    });
    await POST(postEvent('q1', { target: 'u2@test.com' }));
    expect(requireSimRole).toHaveBeenCalledWith(expect.anything(), 'q1', 'manager');
  });

  it('propagates the authz error from requireSimRole (no swallow)', async () => {
    expect.hasAssertions();
    requireSimRole.mockRejectedValue({ status: 403, body: { message: 'insufficient role' } });
    const status = await httpStatus(() => POST(postEvent('q1', { target: 'u2@test.com' })));
    expect(status).toBe(403);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('400 when target is missing', async () => {
    expect.hasAssertions();
    const res = await POST(postEvent('q1', {}));
    expect(res.status).toBe(400);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('passes canInviteByEmail derived from the inviter (verified → true)', async () => {
    expect.hasAssertions();
    createInvite.mockResolvedValue({
      invite: { id: 'inv1', invitedEmail: null },
      token: 'tok',
      resolvedUser: null
    });
    const res = await POST(postEvent('q1', { target: 'u2@test.com' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'inv1', display: 'u2@test.com', invitedByEmail: false });
    expect(createInvite).toHaveBeenCalledWith({
      db: {},
      simId: 'q1',
      invitedByUserId: 'u1',
      canInviteByEmail: true,
      target: { kind: 'email', email: 'u2@test.com' }
    });
  });

  it('passes canInviteByEmail false for an unverified-email inviter', async () => {
    expect.hasAssertions();
    getUser.mockResolvedValue({ ...verifiedInviter, emailVerified: false });
    createInvite.mockResolvedValue({
      invite: { id: 'inv2', invitedEmail: null },
      resolvedUser: null
    });
    await POST(postEvent('q1', { target: '@bob' }));
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        canInviteByEmail: false,
        target: { kind: 'handle', handle: 'bob' }
      })
    );
  });

  it('400 + message when the invite service rejects', async () => {
    expect.hasAssertions();
    createInvite.mockRejectedValue(new Error('email invites require a verified account'));
    const res = await POST(postEvent('q1', { target: 'stranger@test.com' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'email invites require a verified account' });
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('does not send an email when there is no recipient address', async () => {
    expect.hasAssertions();
    createInvite.mockResolvedValue({
      invite: { id: 'inv1', invitedEmail: null },
      token: 'tok',
      resolvedUser: null
    });
    await POST(postEvent('q1', { target: '@bob' }));
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('skips the email send when the per-recipient cooldown is over limit', async () => {
    expect.hasAssertions();
    // IP ok, identity ok (both go through enforceMutationRate — see beforeEach);
    // recipient-email key over limit (the silent, non-throwing `enforceRate` guard).
    enforceRate.mockResolvedValueOnce(false);
    createInvite.mockResolvedValue({
      invite: { id: 'inv3', invitedEmail: 'u2@test.com' },
      token: 'tok',
      resolvedUser: null
    });
    const res = await POST(postEvent('q1', { target: 'u2@test.com' }));
    expect(res.status).toBe(201);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('still returns 201 when sendInviteEmail rejects (email failure must not surface as 400)', async () => {
    expect.hasAssertions();
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ title: 'Test Sim' }])
        }))
      }))
    };
    getDb.mockReturnValueOnce(mockDb);
    createInvite.mockResolvedValue({
      invite: { id: 'inv4', invitedEmail: 'u3@test.com' },
      token: 'tok2',
      resolvedUser: null
    });
    sendInviteEmail.mockRejectedValue(new Error('SMTP timeout'));
    const res = await POST(postEvent('q1', { target: 'u3@test.com' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'inv4', display: 'u3@test.com', invitedByEmail: true });
  });

  it('returns the full pending-invite row so the client can local-apply it', async () => {
    expect.hasAssertions();
    createInvite.mockResolvedValue({
      invite: { id: 'inv5', invitedEmail: null },
      resolvedUser: null
    });
    getManagerPendingInvite.mockResolvedValue({
      id: 'inv5',
      display: '@mara',
      invitedByEmail: false,
      createdAt: new Date(),
      expiresAt: new Date()
    });
    const res = await POST(postEvent('q1', { target: '@mara' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; display: string; invitedByEmail: boolean };
    expect(body.id).toBeTruthy();
    expect(body.display).toBe('@mara');
    expect(typeof body.invitedByEmail).toBe('boolean');
    // The read-back is sim-scoped — an invite id alone is not a manager-view lookup key.
    expect(getManagerPendingInvite).toHaveBeenCalledWith(
      expect.objectContaining({ simId: 'q1', inviteId: 'inv5' })
    );
  });

  it('still returns 201 with a usable display when the read-back throws (invite already landed)', async () => {
    expect.hasAssertions();
    createInvite.mockResolvedValue({
      invite: { id: 'inv6', invitedEmail: null },
      resolvedUser: null
    });
    getManagerPendingInvite.mockRejectedValue(new Error('D1 unavailable'));
    const res = await POST(postEvent('q1', { target: '  Mixed@Case.Test  ' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'inv6',
      display: 'mixed@case.test',
      invitedByEmail: false
    });
  });

  it('normalizes a fallback handle display (leading @ stripped then re-prefixed)', async () => {
    expect.hasAssertions();
    createInvite.mockResolvedValue({
      invite: { id: 'inv7', invitedEmail: null },
      resolvedUser: null
    });
    getManagerPendingInvite.mockRejectedValue(new Error('D1 unavailable'));
    const res = await POST(postEvent('q1', { target: '@Mara' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'inv7',
      display: '@Mara',
      invitedByEmail: false
    });
  });
});

describe('POST /api/sims/:simId/invites (cross-site defence)', () => {
  function rawEvent(headers: Record<string, string>) {
    return {
      params: { simId: 'q1' },
      platform: { env: { INVITE_RL: {} } },
      url: new URL('http://x/api/sims/q1/invites'),
      locals: { user: { id: 'u1', email: 'u1@test.com' } },
      request: new Request('http://x/api/sims/q1/invites', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target: 'u2@test.com' })
      })
    } as unknown as Parameters<typeof POST>[0];
  }

  it('415s a body that is not application/json, before authorizing', async () => {
    expect.hasAssertions();
    const res = await POST(rawEvent({ 'content-type': 'text/plain' }));
    expect(res.status).toBe(415);
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('415s a body with no content type', async () => {
    expect.hasAssertions();
    const res = await POST(rawEvent({}));
    expect(res.status).toBe(415);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('403s a foreign Origin, before authorizing', async () => {
    expect.hasAssertions();
    const res = await POST(
      rawEvent({ 'content-type': 'application/json', origin: 'https://evil.example' })
    );
    expect(res.status).toBe(403);
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });
});

const RAW_TOKEN = 'deadbeef'.repeat(8);

describe('POST /api/sims/:simId/invites — token never leaves the server', () => {
  beforeEach(() => {
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [{ title: 'Trip' }] }) })
    });
    createInvite.mockResolvedValue({
      invite: { id: 'inv1', invitedEmail: 'guest@test.com' },
      token: RAW_TOKEN,
      resolvedUser: null
    });
  });

  it('returns the invite row with no raw token anywhere in the body', async () => {
    expect.hasAssertions();
    const res = await POST(postEvent('q1', { target: 'guest@test.com' }));
    expect(res.status).toBe(201);
    const text = await res.clone().text();
    expect(text).not.toContain(RAW_TOKEN);
    expect(await res.json()).toEqual({
      id: 'inv1',
      display: 'guest@test.com',
      invitedByEmail: true
    });
    expect(sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ token: RAW_TOKEN }));
  });

  it('never logs the raw token, even when the email send fails', async () => {
    expect.hasAssertions();
    const { error: errSpy } = mockConsole('error');
    sendInviteEmail.mockRejectedValue(new Error('SES down'));
    const res = await POST(postEvent('q1', { target: 'guest@test.com' }));
    expect(res.status).toBe(201);
    expect(await res.clone().text()).not.toContain(RAW_TOKEN);
    for (const call of errSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(RAW_TOKEN);
    }
    errSpy.mockRestore();
  });
});
