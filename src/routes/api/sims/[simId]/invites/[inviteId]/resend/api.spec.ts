import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';

const { requireSimRole, resendInvite, sendInviteEmail, getUser, getDb, enforceMutationRate } =
  vi.hoisted(() => {
    const makeDb = () => ({});
    return {
      requireSimRole: vi.fn(),
      resendInvite: vi.fn(),
      sendInviteEmail: vi.fn(),
      getUser: vi.fn(),
      getDb: vi.fn(makeDb),
      enforceMutationRate: vi.fn()
    };
  });

vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole }));
vi.mock('$lib/server/db', () => ({ getDb }));
vi.mock('$lib/server/security/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/security/rate-limit')>();
  return { ...actual, enforceMutationRate };
});
vi.mock('$lib/server/invites/email', () => ({ sendInviteEmail }));
vi.mock('$lib/server/user-store/user', () => ({ getUser }));
vi.mock('$lib/server/invites/control-plane', () => ({ resendInvite }));

import { PSEUDONYMOUS_EMAIL_DOMAIN } from '$lib/server/auth/brand';
import { POST } from './+server';

function postEvent(simId: string, inviteId: string) {
  return {
    params: { simId, inviteId },
    platform: { env: {} },
    url: new URL(`http://x/api/sims/${simId}/invites/${inviteId}/resend`),
    locals: { user: { id: 'u1', email: 'u1@test.com' } },
    request: new Request(`http://x/api/sims/${simId}/invites/${inviteId}/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
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

beforeEach(() => {
  vi.clearAllMocks();
  requireSimRole.mockResolvedValue({
    role: 'manager',
    actor: { actorId: 'u1', actorKind: 'human' }
  });
  enforceMutationRate.mockResolvedValue(undefined);
});

describe('POST /api/sims/:simId/invites/:inviteId/resend', () => {
  it('429s when the invite velocity limit is exceeded', async () => {
    expect.hasAssertions();
    enforceMutationRate.mockRejectedValue({
      status: 429,
      body: { message: 'Too many invites too quickly. Please slow down.' }
    });
    const status = await httpStatus(() => POST(postEvent('q1', 'inv1')));
    expect(status).toBe(429);
    expect(resendInvite).not.toHaveBeenCalled();
  });

  it('415s a request that is not application/json, before authorizing', async () => {
    expect.hasAssertions();
    const event = postEvent('q1', 'inv1');
    const res = await POST({
      ...event,
      request: new Request(event.request.url, { method: 'POST' })
    } as typeof event);
    expect(res.status).toBe(415);
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(resendInvite).not.toHaveBeenCalled();
  });

  it('403s a foreign Origin, before authorizing', async () => {
    expect.hasAssertions();
    const event = postEvent('q1', 'inv1');
    const res = await POST({
      ...event,
      request: new Request(event.request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' }
      })
    } as typeof event);
    expect(res.status).toBe(403);
    expect(requireSimRole).not.toHaveBeenCalled();
    expect(resendInvite).not.toHaveBeenCalled();
  });

  it('authorizes as manager before resending', async () => {
    expect.hasAssertions();
    resendInvite.mockResolvedValue({ emailed: false, token: null, invite: null });
    await POST(postEvent('q1', 'inv1'));
    expect(requireSimRole).toHaveBeenCalledWith(expect.anything(), 'q1', 'manager');
  });

  it('200 + { emailed } on happy path (no recipient → no email sent)', async () => {
    expect.hasAssertions();
    resendInvite.mockResolvedValue({ emailed: false, token: null, invite: null });
    const res = await POST(postEvent('q1', 'inv1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ emailed: false });
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('400 when the resend service rejects', async () => {
    expect.hasAssertions();
    resendInvite.mockRejectedValue(new Error('invite not found'));
    const res = await POST(postEvent('q1', 'inv1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invite not found' });
  });

  it('returns only { emailed }, never the rotated raw token', async () => {
    expect.hasAssertions();
    const RAW_TOKEN = 'feedface'.repeat(8);
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [{ title: 'Trip' }] }) })
    });
    getUser.mockResolvedValue({ handle: 'ada', email: 'ada@test.com' });
    resendInvite.mockResolvedValue({
      emailed: true,
      token: RAW_TOKEN,
      invite: { id: 'inv1', invitedEmail: 'guest@test.com', invitedByUserId: 'u1' }
    });
    const res = await POST(postEvent('q1', 'inv1'));
    expect(res.status).toBe(200);
    expect(await res.clone().text()).not.toContain(RAW_TOKEN);
    expect(await res.json()).toEqual({ emailed: true });
    expect(sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ token: RAW_TOKEN }));
  });

  it('sends no mail to a pseudonymous invitee', async () => {
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [{ title: 'Trip' }] }) })
    });
    getUser.mockResolvedValue({ handle: 'pseudo', email: `temp-x@${PSEUDONYMOUS_EMAIL_DOMAIN}` });
    resendInvite.mockResolvedValue({
      emailed: true,
      token: 'tok',
      invite: { id: 'inv1', invitedEmail: null, invitedUserId: 'p1', invitedByUserId: 'u1' }
    });
    const res = await POST(postEvent('q1', 'inv1'));
    expect(res.status).toBe(200);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('never logs the rotated token when the email send fails', async () => {
    expect.hasAssertions();
    const RAW_TOKEN = 'feedface'.repeat(8);
    const { error: errSpy } = mockConsole('error');
    getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => [{ title: 'Trip' }] }) })
    });
    getUser.mockResolvedValue({ handle: 'ada', email: 'ada@test.com' });
    resendInvite.mockResolvedValue({
      emailed: true,
      token: RAW_TOKEN,
      invite: { id: 'inv1', invitedEmail: 'guest@test.com', invitedByUserId: 'u1' }
    });
    sendInviteEmail.mockRejectedValue(new Error('SES down'));
    const res = await POST(postEvent('q1', 'inv1'));
    expect(res.status).toBe(200);
    expect(await res.clone().text()).not.toContain(RAW_TOKEN);
    for (const call of errSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(RAW_TOKEN);
    }
    errSpy.mockRestore();
  });
});
