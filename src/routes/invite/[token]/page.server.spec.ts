import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import type { TokenInvite } from '$lib/server/invites/control-plane';
import { MEMBERS_COPY } from '$lib/members/copy';

// A chainable db.update(...).set(...).where(...) stub so the email-bound mint branch can
// drive it. dbUpdateSetMock captures the `.set({...})` payload for assertions.
const dbUpdateWhereMock = vi.fn(async () => undefined);
const dbUpdateSetMock = vi.fn((_values: Record<string, unknown>) => ({ where: dbUpdateWhereMock }));
const dbUpdateMock = vi.fn(() => ({ set: dbUpdateSetMock }));
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(() => ({ update: dbUpdateMock }) as never) }));
vi.mock('$lib/server/invites/control-plane', () => ({
  findInviteByToken: vi.fn(),
  acceptInviteByToken: vi.fn()
}));
vi.mock('$lib/server/sims/roster-hook', () => ({
  onSimRosterChanged: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/invites/claim', () => ({ classifyColdAccept: vi.fn() }));
vi.mock('$lib/server/onboarding/known-device', () => ({ isKnownDevice: vi.fn(() => false) }));
const stashPendingIdentifierMock = vi.fn();
vi.mock('$lib/server/onboarding/pending-identifier', () => ({
  stashPendingIdentifier: (...a: unknown[]) => stashPendingIdentifierMock(...a)
}));
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: vi.fn() }));
vi.mock('$lib/server/user-store/identity', () => ({ reseedHandleFromSim: vi.fn() }));
vi.mock('$lib/server/user-store/handle', () => ({
  generateUniqueHandle: vi.fn(async () => 'unique-handle')
}));
vi.mock('$lib/server/user-store/history', () => ({ recordUserVersion: vi.fn() }));
// e2e/env (isE2eEnv) is NOT mocked: the default test platform is not an e2e env, so there
// is no devLink. The dev-link test below stubs VITE_E2E and a development platform to flip it on.
const signInMagicLinkMock = vi.fn();
const MAGIC_VERIFY_URL = 'https://app.test/api/auth/magic-link/verify?token=xyz';
// The join action passes a captureMagicLink sink only in an e2e env (isE2eEnv). When a sink
// is provided, this fake drives it with a fixed verify url so the action surfaces it as
// `devLink`; with no sink (production) signInMagicLink just sends and captures nothing.
let lastGetAuthOpts: { captureMagicLink?: (m: { email: string; url: string }) => void } | undefined;
const getAuthMock = vi.fn(
  (
    _platform: App.Platform,
    _origin: string,
    opts?: { captureMagicLink?: (m: { email: string; url: string }) => void }
  ) => {
    lastGetAuthOpts = opts;
    return {
      api: {
        signInMagicLink: vi.fn(async (args: { body: { email: string } }) => {
          opts?.captureMagicLink?.({ email: args.body.email, url: MAGIC_VERIFY_URL });
          return signInMagicLinkMock(args);
        })
      }
    };
  }
);
vi.mock('$lib/server/auth/better-auth', () => ({
  getAuth: (...a: Parameters<typeof getAuthMock>) => getAuthMock(...a)
}));

import { findInviteByToken, acceptInviteByToken } from '$lib/server/invites/control-plane';
import { classifyColdAccept } from '$lib/server/invites/claim';
import { onSimRosterChanged } from '$lib/server/sims/roster-hook';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { mintPseudonymousSession } from '$lib/server/onboarding/pseudonymous-mint';
import { reseedHandleFromSim } from '$lib/server/user-store/identity';
import { recordUserVersion } from '$lib/server/user-store/history';
import { skeleton } from '$lib/server/user-store/confusable-skeleton';
import { load, actions } from './+page.server';

const findMock = vi.mocked(findInviteByToken);
const acceptMock = vi.mocked(acceptInviteByToken);
const classifyMock = vi.mocked(classifyColdAccept);
const rosterMock = vi.mocked(onSimRosterChanged);
const isKnownDeviceMock = vi.mocked(isKnownDevice);
const mintMock = vi.mocked(mintPseudonymousSession);
const reseedMock = vi.mocked(reseedHandleFromSim);
const recordUserVersionMock = vi.mocked(recordUserVersion);

const platform = { env: {} } as unknown as App.Platform;

afterEach(() => {
  vi.unstubAllEnvs();
});

function joinEvent(fields: Record<string, string>, token = 'tok') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    params: { token },
    platform,
    cookies: {} as never,
    url: new URL('https://app.test/invite/tok'),
    request: { formData: async () => fd, headers: new Headers() }
  } as unknown as Parameters<typeof actions.join>[0];
}

function loadEvent(opts: { token?: string; user?: { id: string } | null }) {
  return {
    params: { token: opts.token ?? 'tok' },
    platform,
    locals: { user: opts.user ?? null }
  } as unknown as Parameters<typeof load>[0];
}

function acceptEvent(opts: { token?: string; user?: { id: string } | null }) {
  return {
    params: { token: opts.token ?? 'tok' },
    platform,
    locals: { user: opts.user ?? null }
  } as unknown as Parameters<typeof actions.accept>[0];
}

const pendingInvite: TokenInvite = {
  id: 'inv1',
  simId: 'q1',
  simTitle: 'Trip',
  inviterHandle: 'ada',
  invitedEmail: 'guest@test.com',
  status: 'pending',
  expired: false
};

describe('invite token landing — load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns invite:null for a missing invite', async () => {
    findMock.mockResolvedValue(null);
    const result = await load(loadEvent({}));
    expect(result).toEqual({ invite: null, signedIn: false });
  });

  it('returns invite:null for a non-pending invite', async () => {
    findMock.mockResolvedValue({ ...pendingInvite, status: 'accepted' });
    const result = await load(loadEvent({}));
    expect(result).toMatchObject({ invite: null });
  });

  it('returns invite:null for an expired invite', async () => {
    findMock.mockResolvedValue({ ...pendingInvite, expired: true });
    const result = await load(loadEvent({}));
    expect(result).toMatchObject({ invite: null });
  });

  it('returns invite fields for a pending invite, with signedIn flag', async () => {
    findMock.mockResolvedValue(pendingInvite);
    const result = await load(loadEvent({ user: { id: 'u1' } }));
    expect(result).toEqual({
      invite: {
        simTitle: 'Trip',
        inviterHandle: 'ada',
        invitedEmail: 'guest@test.com'
      },
      signedIn: true
    });
  });
});

describe('invite token landing — accept action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to / when unauthenticated', async () => {
    let caught: unknown;
    try {
      await actions.accept(acceptEvent({ user: null }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/');
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('redirects to the sim on successful accept', async () => {
    acceptMock.mockResolvedValue({ simId: 'q1' });
    let caught: unknown;
    try {
      await actions.accept(acceptEvent({ user: { id: 'u1' } }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims/q1');
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', userId: 'u1' })
    );
    expect(rosterMock).toHaveBeenCalledWith('q1');
  });

  it('returns fail(400) with the error message when the service throws', async () => {
    acceptMock.mockRejectedValue(new Error('invite expired'));
    const result = await actions.accept(acceptEvent({ user: { id: 'u1' } }));
    expect(result).toMatchObject({ status: 400, data: { error: 'invite expired' } });
    expect(rosterMock).not.toHaveBeenCalled();
  });
});

describe('invite token landing — join action (cold-accept)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastGetAuthOpts = undefined;
    findMock.mockResolvedValue(pendingInvite);
    isKnownDeviceMock.mockReturnValue(false);
  });

  it('fails when the invite is no longer valid', async () => {
    findMock.mockResolvedValue(null);
    const result = await actions.join(joinEvent({}));
    expect(result).toMatchObject({ status: 400 });
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it('known device, not starting fresh → steers to /signin, no mint attempted', async () => {
    isKnownDeviceMock.mockReturnValue(true);
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: true });
    let caught: unknown;
    try {
      await actions.join(joinEvent({ email: '' }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toContain('/signin?returnTo=');
    expect((caught as { location: string }).location).toContain('%2Finvite%2F');
    expect(mintMock).not.toHaveBeenCalled();
  });

  it('known device, not starting fresh, WITH a typed email → steers to /signin and stashes it (SC 3.3.7)', async () => {
    isKnownDeviceMock.mockReturnValue(true);
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: true });
    let caught: unknown;
    try {
      await actions.join(joinEvent({ email: 'typed@test.com' }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toContain('/signin?returnTo=');
    expect((caught as { location: string }).location).toContain('%2Finvite%2F');
    expect(mintMock).not.toHaveBeenCalled();
    // SC 3.3.7: the address the user just typed rides along so /signin can seed it.
    expect(stashPendingIdentifierMock).toHaveBeenCalledWith(expect.anything(), 'typed@test.com');
  });

  it('known device + fresh=1 bypasses steering and mints instantly', async () => {
    isKnownDeviceMock.mockReturnValue(true);
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: true });
    mintMock.mockResolvedValue({ ok: true, user: { id: 'ident1' } as never });
    acceptMock.mockResolvedValue({ simId: 'q1' });
    let caught: unknown;
    try {
      await actions.join(joinEvent({ email: '', fresh: '1' }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims/q1');
    expect(mintMock).toHaveBeenCalled();
    expect(rosterMock).toHaveBeenCalledWith('q1');
  });

  it('pseudonymous mint (handle invite): seeds handle from sim title, auto-accepts, redirects to the sim', async () => {
    findMock.mockResolvedValue({ ...pendingInvite, invitedEmail: null });
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: true });
    mintMock.mockResolvedValue({ ok: true, user: { id: 'ident1' } as never });
    acceptMock.mockResolvedValue({ simId: 'q1' });
    let caught: unknown;
    try {
      await actions.join(joinEvent({ email: '' }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims/q1');
    expect(reseedMock).toHaveBeenCalledWith(
      expect.objectContaining({ identityId: 'ident1', simTitle: 'Trip' })
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', userId: 'ident1' })
    );
    expect(rosterMock).toHaveBeenCalledWith('q1');
  });

  it('email-bound mint (emailed invite, unknown account): binds the invited email UNVERIFIED, auto-accepts', async () => {
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: false });
    mintMock.mockResolvedValue({ ok: true, user: { id: 'ident1' } as never });
    acceptMock.mockResolvedValue({ simId: 'q1' });
    let caught: unknown;
    try {
      await actions.join(joinEvent({ email: 'Guest@Test.com' }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims/q1');
    // The live user row is updated to bind the invited email, unverified + non-pseudonymous.
    expect(dbUpdateMock).toHaveBeenCalled();
    expect(dbUpdateWhereMock).toHaveBeenCalled();
    const setPayload = dbUpdateSetMock.mock.calls[0][0] as unknown as {
      email: string;
      emailVerified: boolean;
      isAnonymous: boolean;
      handle: string;
      handleSkeleton: string;
    };
    expect(setPayload.email).toBe('guest@test.com');
    expect(setPayload.emailVerified).toBe(false);
    expect(setPayload.isAnonymous).toBe(false);
    expect(setPayload.handle).toBe('unique-handle');
    // The write MUST stamp handleSkeleton = skeleton(handle), or the confusable-uniqueness
    // gate is defeated (a stale skeleton lets someone register a confusable later).
    expect(setPayload.handleSkeleton).toBe(skeleton('unique-handle'));
    expect(recordUserVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'ident1',
        email: 'guest@test.com',
        handle: 'unique-handle'
      })
    );
    expect(reseedMock).not.toHaveBeenCalled();
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', userId: 'ident1' })
    );
    expect(rosterMock).toHaveBeenCalledWith('q1');
  });

  it('email-bound mint: returns a friendly fail when binding the email collides', async () => {
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: false });
    mintMock.mockResolvedValue({ ok: true, user: { id: 'ident1' } as never });
    dbUpdateWhereMock.mockRejectedValueOnce(new Error('UNIQUE constraint failed: user.email'));
    const result = await actions.join(joinEvent({ email: 'guest@test.com' }));
    expect(result).toMatchObject({
      status: 400,
      data: { error: MEMBERS_COPY.createAccountFailed }
    });
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('mint: a failed mint (e.g. rate-limited) fails without touching the invite', async () => {
    classifyMock.mockResolvedValue({ kind: 'mint', pseudonymous: true });
    mintMock.mockResolvedValue({ ok: false, status: 429, message: 'slow down' });
    const result = await actions.join(joinEvent({ email: '' }));
    expect(result).toMatchObject({ status: 429, data: { error: 'slow down' } });
    expect(reseedMock).not.toHaveBeenCalled();
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('A2: magic-link-only account is sent a REAL magic link to the invited inbox, no auto sign-in', async () => {
    classifyMock.mockResolvedValue({ kind: 'signin', strongFactor: false, userId: 'u9' });
    signInMagicLinkMock.mockResolvedValue({});
    // Possession of the invite token must NOT mint a session: no redirect to a verify URL.
    const result = await actions.join(joinEvent({ email: 'guest@test.com' }));
    expect(result).toMatchObject({ checkEmail: true });
    // A REAL magic link is sent (no capture sink), to the INVITED address.
    expect(lastGetAuthOpts?.captureMagicLink).toBeUndefined();
    expect(signInMagicLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: 'guest@test.com', callbackURL: '/invite/tok' } })
    );
    expect(mintMock).not.toHaveBeenCalled();
  });

  it('A3: strong-factor account redirects to real sign-in with returnTo', async () => {
    classifyMock.mockResolvedValue({ kind: 'signin', strongFactor: true, userId: 'u9' });
    let caught: unknown;
    try {
      await actions.join(joinEvent({ email: 'guest@test.com' }));
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/signin?returnTo=%2Finvite%2Ftok');
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
    // SC 3.3.7: the address the user just typed rides along so /signin can seed it.
    expect(stashPendingIdentifierMock).toHaveBeenCalledWith(expect.anything(), 'guest@test.com');
  });

  it('C: changed email sends a REAL magic link (no capture sink), check-email', async () => {
    classifyMock.mockResolvedValue({ kind: 'verify', email: 'other@test.com' });
    signInMagicLinkMock.mockResolvedValue({});
    const result = await actions.join(joinEvent({ email: 'other@test.com' }));
    expect(result).toMatchObject({ checkEmail: true });
    // No capture sink → the normal emailing path.
    expect(lastGetAuthOpts?.captureMagicLink).toBeUndefined();
    expect(signInMagicLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: 'other@test.com', callbackURL: '/invite/tok' } })
    );
  });

  it('returns the captured dev-link in an e2e env for the signin (A2) branch', async () => {
    // The verify URL is captured synchronously from sendMagicLink, in the same request.
    // Only an e2e env arms the capture sink: VITE_E2E=1 and ENVIRONMENT=development.
    classifyMock.mockResolvedValue({ kind: 'signin', strongFactor: false, userId: 'u9' });
    signInMagicLinkMock.mockResolvedValue({});
    vi.stubEnv('VITE_E2E', '1');
    const e2ePlatform = { env: { ENVIRONMENT: 'development' } } as unknown as App.Platform;
    const fd = new FormData();
    fd.set('email', 'guest@test.com');
    const event = {
      params: { token: 'tok' },
      platform: e2ePlatform,
      cookies: {} as never,
      url: new URL('https://app.test/invite/tok'),
      request: { formData: async () => fd, headers: new Headers() }
    } as unknown as Parameters<typeof actions.join>[0];
    const result = await actions.join(event);
    expect(result).toEqual({ checkEmail: true, devLink: MAGIC_VERIFY_URL });
    expect(lastGetAuthOpts?.captureMagicLink).toBeTypeOf('function');
  });
});
