import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRedirect, type ActionFailure } from '@sveltejs/kit';
import { AUTH_COPY } from '$lib/account/copy';
import { SIM_TITLE_MAX } from '$lib/members/copy';

// Mocks for the action's collaborators.
const enforceRate = vi.fn();
const resolveHandleToEmail = vi.fn();
const signInMagicLink = vi.fn();
const signInEmail = vi.fn();
const readPendingSim = vi.fn();
const clearPendingSim = vi.fn();
const readPendingIdentifier = vi.fn();
const clearPendingIdentifier = vi.fn();
const mintPseudonymousSession = vi.fn();
const reseedHandleFromSim = vi.fn();
const createSim = vi.fn();
let e2e = false;

vi.mock('$lib/server/e2e/env', () => ({ isE2eEnv: () => e2e }));
vi.mock('$lib/server/security/rate-limit', () => ({
  enforceRate: (...a: unknown[]) => enforceRate(...a)
}));
vi.mock('$lib/server/auth/magic-link', () => ({
  resolveHandleToEmail: (...a: unknown[]) => resolveHandleToEmail(...a)
}));
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/onboarding/pending-sim', () => ({
  readPendingSim: (...a: unknown[]) => readPendingSim(...a),
  clearPendingSim: (...a: unknown[]) => clearPendingSim(...a)
}));
vi.mock('$lib/server/onboarding/pending-identifier', () => ({
  readPendingIdentifier: (...a: unknown[]) => readPendingIdentifier(...a),
  clearPendingIdentifier: (...a: unknown[]) => clearPendingIdentifier(...a)
}));
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({
  mintPseudonymousSession: (...a: unknown[]) => mintPseudonymousSession(...a)
}));
vi.mock('$lib/server/user-store/identity', () => ({
  reseedHandleFromSim: (...a: unknown[]) => reseedHandleFromSim(...a)
}));
vi.mock('$lib/server/sims/sims', () => ({
  createSim: (...a: unknown[]) => createSim(...a)
}));
// start-sim's title check is the real one; the rest of that module is not under test here.
vi.mock('$lib/server/sims/start-sim', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/sims/start-sim')>(
    '$lib/server/sims/start-sim'
  );
  return { checkSimTitle: actual.checkSimTitle };
});
// The magic-link verify URL the fake sendMagicLink hands to captureMagicLink.
const MAGIC_VERIFY_URL = 'https://app.test/api/auth/magic-link/verify?token=xyz';
const fakeAuth = (opts?: { captureMagicLink?: (l: { email: string; url: string }) => void }) => ({
  api: {
    // Mirror the real flow: signInMagicLink drives sendMagicLink, which hands the verify
    // URL to the caller's capture sink synchronously, in-process.
    signInMagicLink: (...a: unknown[]) => {
      opts?.captureMagicLink?.({ email: 'x', url: MAGIC_VERIFY_URL });
      return signInMagicLink(...a);
    },
    signInEmail: (...a: unknown[]) => signInEmail(...a)
  }
});
vi.mock('$lib/server/auth/better-auth', () => ({
  authFor: () => fakeAuth(),
  getAuth: (
    _p: unknown,
    _o: unknown,
    opts?: { captureMagicLink?: (l: { email: string; url: string }) => void }
  ) => ({
    api: {
      // Mirror the real flow: signInMagicLink drives sendMagicLink, which hands the verify
      // URL to the caller's capture sink synchronously, in-process.
      signInMagicLink: (...a: unknown[]) => {
        opts?.captureMagicLink?.({ email: 'x', url: MAGIC_VERIFY_URL });
        return signInMagicLink(...a);
      },
      signInEmail: (...a: unknown[]) => signInEmail(...a)
    }
  })
}));

import { actions, load } from './+page.server';

/** SES keys: a mail provider is configured, so magic link is in effect. */
const MAIL = { SES_ACCESS_KEY_ID: 'key-id', SES_SECRET_ACCESS_KEY: 'secret' };

function makeEvent(
  form: Record<string, string>,
  envExtra: Record<string, unknown> = {},
  url = 'https://app.test/signin'
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  const request = new Request('https://app.test/signin', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '1.2.3.4' }
  });
  vi.spyOn(request, 'formData').mockResolvedValue(fd);
  return {
    request,
    locals: { user: null },
    platform: { env: { AUTH_LINK_RL: undefined, ...MAIL, ...envExtra } },
    url: new URL(url),
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }
  } as never;
}

/** An event for a password action: password sign-in switched on. */
function makePasswordEvent(form: Record<string, string>) {
  return makeEvent(form, { AUTH_METHODS: 'password' });
}

beforeEach(() => {
  vi.clearAllMocks();
  e2e = false;
  enforceRate.mockResolvedValue(true);
  resolveHandleToEmail.mockResolvedValue(null);
  signInMagicLink.mockResolvedValue({});
  signInEmail.mockResolvedValue({});
  readPendingSim.mockReturnValue(null);
  clearPendingSim.mockReturnValue(undefined);
  readPendingIdentifier.mockReturnValue(null);
  clearPendingIdentifier.mockReturnValue(undefined);
  mintPseudonymousSession.mockResolvedValue({
    ok: true,
    user: { id: 'pseudo-u1', pseudonymous: true }
  });
  reseedHandleFromSim.mockResolvedValue('some-handle');
  createSim.mockResolvedValue({ simId: 'sid-1' });
});

function makeLoadEvent(url: string, envExtra: Record<string, unknown> = {}) {
  return {
    locals: { user: null },
    platform: { env: { ...MAIL, ...envExtra } },
    url: new URL(url),
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }
  } as never;
}

function makeStartFreshEvent(envExtra: Record<string, unknown> = {}) {
  return {
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    request: new Request('https://app.test/signin', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' }
    }),
    locals: { user: null },
    platform: { env: { ...MAIL, ...envExtra } },
    url: new URL('https://app.test/signin')
  } as never;
}

describe('signin load', () => {
  it('returns signup: true when the URL has ?signup=1', async () => {
    const res = await load(makeLoadEvent('https://app.test/signin?signup=1'));
    expect(res).toMatchObject({ signup: true });
  });

  it('returns signup: false without the query param', async () => {
    const res = await load(makeLoadEvent('https://app.test/signin'));
    expect(res).toMatchObject({ signup: false });
  });

  it('surfaces a stashed pending-sim title', async () => {
    readPendingSim.mockReturnValue('Learn to swim');
    const res = await load(makeLoadEvent('https://app.test/signin'));
    expect(res).toMatchObject({ pendingSim: 'Learn to swim' });
  });

  it('returns pendingSim: null when nothing is stashed', async () => {
    const res = await load(makeLoadEvent('https://app.test/signin'));
    expect(res).toMatchObject({ pendingSim: null });
  });

  it('surfaces a stashed pending identifier so the form can seed it', async () => {
    readPendingIdentifier.mockReturnValue('someone@example.com');
    const res = await load(makeLoadEvent('https://app.test/signin'));
    expect(res).toMatchObject({ pendingIdentifier: 'someone@example.com' });
  });

  it('returns pendingIdentifier: null when nothing is stashed', async () => {
    const res = await load(makeLoadEvent('https://app.test/signin'));
    expect(res).toMatchObject({ pendingIdentifier: null });
  });

  it('returns only magic-link under the default methods', async () => {
    const res = await load(makeLoadEvent('https://app.test/signin'));
    expect(res).toMatchObject({ methods: ['magic-link'] });
  });

  it('returns no method when no mail provider is configured', async () => {
    const res = await load({
      ...(makeLoadEvent('https://app.test/signin') as object),
      platform: { env: {} }
    } as never);
    expect(res).toMatchObject({ methods: [] });
  });

  it('returns the switched-on methods', async () => {
    const res = await load(
      makeLoadEvent('https://app.test/signin', {
        AUTH_METHODS: 'password,passkey,google',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret'
      })
    );
    expect((res as { methods: string[] }).methods.sort()).toEqual([
      'google',
      'magic-link',
      'passkey',
      'password'
    ]);
  });

  it('flags a failed magic link, and not as a Google error', async () => {
    const res = await load(
      makeLoadEvent('https://app.test/signin?returnTo=%2Fsims&link=failed&error=INVALID_TOKEN')
    );
    expect(res).toMatchObject({ linkError: true, googleError: false });
  });

  it('shows no Google error while Google is off, whatever ?error says', async () => {
    const res = await load(makeLoadEvent('https://app.test/signin?error=signup_disabled'));
    expect(res).toMatchObject({ linkError: false, googleError: false });
  });

  it('flags a Google error when Google is on', async () => {
    const res = await load(
      makeLoadEvent('https://app.test/signin?error=signup_disabled', {
        AUTH_METHODS: 'google',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret'
      })
    );
    expect(res).toMatchObject({ linkError: false, googleError: true });
  });

  it('redirects a signed-in user to a safe returnTo', async () => {
    const event = makeLoadEvent('https://app.test/signin?returnTo=/sims') as unknown as {
      locals: { user: unknown };
    };
    event.locals.user = { id: 'u1' };
    let caught: unknown;
    try {
      await load(event as never);
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims');
  });
});

describe('signin sendLink action', () => {
  it('rejects with 429 when rate-limited', async () => {
    enforceRate.mockResolvedValue(false);
    const res = (await actions.sendLink(makeEvent({ identifier: 'x@y.com' }))) as ActionFailure<{
      error: string;
    }>;
    expect(res.status).toBe(429);
    expect(res.data.error).toBe(AUTH_COPY.tooManySignin);
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('sends a link for an email identifier and returns the neutral sent flag', async () => {
    const res = await actions.sendLink(makeEvent({ identifier: 'New@Person.com' }));
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'new@person.com' }) })
    );
    expect(res).toEqual({ sent: true });
  });

  it('resolves a handle to an email before sending', async () => {
    resolveHandleToEmail.mockResolvedValue('found@example.com');
    await actions.sendLink(makeEvent({ identifier: 'oldtimer-fox' }));
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'found@example.com' }) })
    );
  });

  it('returns the neutral sent flag but sends nothing for an unknown handle', async () => {
    resolveHandleToEmail.mockResolvedValue(null);
    const res = await actions.sendLink(makeEvent({ identifier: 'ghost' }));
    expect(signInMagicLink).not.toHaveBeenCalled();
    expect(res).toMatchObject({ sent: true });
  });

  it('rejects with 400 when the identifier is empty', async () => {
    const res = (await actions.sendLink(makeEvent({ identifier: '   ' }))) as ActionFailure<{
      error: string;
    }>;
    expect(res.status).toBe(400);
    expect(res.data.error).toBe(AUTH_COPY.enterIdentifier);
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('surfaces the captured dev-link in an e2e env so the suite can follow it', async () => {
    // The verify URL is captured synchronously from sendMagicLink (same request, no
    // round-trip), and only when isE2eEnv is true.
    e2e = true;
    const res = await actions.sendLink(makeEvent({ identifier: 'guest@test.com' }));
    expect(res).toEqual({ sent: true, devLink: MAGIC_VERIFY_URL });
    // A link actually went out: the stashed identifier (if any) has served its purpose,
    // same one-shot treatment as the pending-sim cookie.
    expect(clearPendingIdentifier).toHaveBeenCalled();
  });

  it('never returns the link outside an e2e env', async () => {
    const res = await actions.sendLink(makeEvent({ identifier: 'guest@test.com' }));
    expect(res).toEqual({ sent: true });
  });

  it('answers 404 and sends nothing when no mail provider is configured', async () => {
    const event = makeEvent({ identifier: 'x@y.com' });
    (event as { platform: App.Platform }).platform = { env: {} } as App.Platform;
    let caught: unknown;
    try {
      await actions.sendLink(event);
    } catch (e) {
      caught = e;
    }
    expect((caught as { status: number }).status).toBe(404);
    expect(enforceRate).not.toHaveBeenCalled();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('carries a safe returnTo into the link as its callbackURL', async () => {
    await actions.sendLink(
      makeEvent({ identifier: 'x@y.com' }, {}, 'https://app.test/signin?returnTo=%2Fsims')
    );
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ callbackURL: '/sims' }) })
    );
  });

  it('sends a failed link back to /signin, keeping returnTo, so the page can say so', async () => {
    await actions.sendLink(
      makeEvent({ identifier: 'x@y.com' }, {}, 'https://app.test/signin?returnTo=%2Fsims')
    );
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          errorCallbackURL: '/signin?link=failed&returnTo=%2Fsims'
        })
      })
    );
  });

  it('replaces an off-site returnTo with / in the callbackURL', async () => {
    await actions.sendLink(
      makeEvent(
        { identifier: 'x@y.com' },
        {},
        'https://app.test/signin?returnTo=https%3A%2F%2Fevil.example%2F'
      )
    );
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ callbackURL: '/' }) })
    );
  });

  it('does NOT send and returns the neutral flag when the per-email limit is exceeded', async () => {
    // First enforceRate call (per-IP) passes; second (per-email) fails.
    enforceRate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await actions.sendLink(makeEvent({ identifier: 'known@example.com' }));
    expect(signInMagicLink).not.toHaveBeenCalled();
    expect(res).toMatchObject({ sent: true });
  });
});

describe('signin signInPassword action', () => {
  it('fails 404 without signing in when password sign-in is off (the default)', async () => {
    const res = (await actions.signInPassword(
      makeEvent({ identifier: 'ada-blue', password: 'correct horse battery staple' })
    )) as ActionFailure<{ error: string }>;
    expect(res.status).toBe(404);
    expect(res.data.error).toBe(AUTH_COPY.signinFailed);
    expect(signInEmail).not.toHaveBeenCalled();
    expect(resolveHandleToEmail).not.toHaveBeenCalled();
    expect(enforceRate).not.toHaveBeenCalled();
  });

  it('fails with a generic error for an unknown handle', async () => {
    resolveHandleToEmail.mockResolvedValue(null);
    const res = (await actions.signInPassword(
      makePasswordEvent({ identifier: 'nobody', password: 'correct horse battery staple' })
    )) as ActionFailure<{ error: string }>;
    expect(res.status).toBe(400);
    expect(res.data.error).toBe(AUTH_COPY.signinFailed);
  });

  it('returns the SAME generic error for a known handle with a wrong password', async () => {
    resolveHandleToEmail.mockResolvedValue('ada@example.com');
    signInEmail.mockRejectedValue(new Error('INVALID_EMAIL_OR_PASSWORD'));
    const res = (await actions.signInPassword(
      makePasswordEvent({ identifier: 'ada-blue', password: 'wrong wrong wrong wrong' })
    )) as ActionFailure<{ error: string }>;
    expect(res.status).toBe(400);
    // Byte-identical to the unknown-handle failure above: a caller cannot tell a
    // non-existent handle from a real one with the wrong password.
    expect(res.data.error).toBe(AUTH_COPY.signinFailed);
  });

  it('strips a leading @ from the identifier', async () => {
    resolveHandleToEmail.mockResolvedValue('ada@example.com');
    try {
      await actions.signInPassword(
        makePasswordEvent({ identifier: '@ada-blue', password: 'correct horse battery staple' })
      );
    } catch {
      // A redirect throw on success is expected; irrelevant to this assertion.
    }
    expect(resolveHandleToEmail).toHaveBeenCalledWith(expect.anything(), 'ada-blue');
  });

  it('rate-limits on BOTH the IP and the handle dimension', async () => {
    resolveHandleToEmail.mockResolvedValue('ada@example.com');
    try {
      await actions.signInPassword(
        makePasswordEvent({ identifier: 'ada-blue', password: 'correct horse battery staple' })
      );
    } catch {
      // A redirect throw on success is expected; irrelevant to this assertion.
    }
    const keys = enforceRate.mock.calls.map((c) => c[1]);
    expect(keys).toEqual(['auth_pw_ip:1.2.3.4', 'auth_pw_handle:ada-blue']);
  });

  it('produces the SAME handle rate-limit key for NFC-equivalent spellings', async () => {
    // 'café' as a single precomposed é (U+00E9) vs. as 'e' + a combining acute
    // accent (U+0065 U+0301): canonically identical, but distinct byte sequences. The
    // key must collapse both onto one bucket, or a caller gets two rate-limit buckets
    // for what is really one handle.
    const precomposed = 'café';
    const decomposed = 'café';
    resolveHandleToEmail.mockResolvedValue(null);

    await actions.signInPassword(
      makePasswordEvent({ identifier: precomposed, password: 'correct horse battery staple' })
    );
    const keyForPrecomposed = enforceRate.mock.calls.find((c) =>
      String(c[1]).startsWith('auth_pw_handle:')
    )?.[1];

    enforceRate.mockClear();
    await actions.signInPassword(
      makePasswordEvent({ identifier: decomposed, password: 'correct horse battery staple' })
    );
    const keyForDecomposed = enforceRate.mock.calls.find((c) =>
      String(c[1]).startsWith('auth_pw_handle:')
    )?.[1];

    expect(keyForPrecomposed).toBe(keyForDecomposed);
  });

  it('rejects with 429 without attempting a sign-in when rate-limited', async () => {
    enforceRate.mockResolvedValue(false);
    const res = (await actions.signInPassword(
      makePasswordEvent({ identifier: 'ada-blue', password: 'correct horse battery staple' })
    )) as ActionFailure<{ error: string }>;
    expect(res.status).toBe(429);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('fails generically when the password is missing, without touching the rate limiter', async () => {
    const res = (await actions.signInPassword(
      makePasswordEvent({ identifier: 'ada-blue', password: '' })
    )) as ActionFailure<{ error: string }>;
    expect(res.status).toBe(400);
    expect(res.data.error).toBe(AUTH_COPY.signinFailed);
    expect(enforceRate).not.toHaveBeenCalled();
  });

  it('signs in and redirects on a correct handle + password', async () => {
    resolveHandleToEmail.mockResolvedValue('ada@example.com');
    signInEmail.mockResolvedValue({});
    let caught: unknown;
    try {
      await actions.signInPassword(
        makePasswordEvent({ identifier: 'ada-blue', password: 'correct horse battery staple' })
      );
    } catch (e) {
      caught = e;
    }
    expect(signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          email: 'ada@example.com',
          password: 'correct horse battery staple'
        })
      })
    );
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/');
    // Sign-in completed: the stashed identifier (if any) has served its purpose.
    expect(clearPendingIdentifier).toHaveBeenCalled();
  });

  it('takes an email identifier straight to sign-in without a handle lookup', async () => {
    signInEmail.mockResolvedValue({});
    try {
      await actions.signInPassword(
        makePasswordEvent({
          identifier: 'Ada@Example.com',
          password: 'correct horse battery staple'
        })
      );
    } catch {
      // A redirect throw on success is expected; irrelevant to this assertion.
    }
    expect(resolveHandleToEmail).not.toHaveBeenCalled();
    expect(signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: 'ada@example.com' }) })
    );
  });

  async function passwordRedirect(returnTo: string): Promise<string> {
    resolveHandleToEmail.mockResolvedValue('ada@example.com');
    signInEmail.mockResolvedValue({});
    let caught: unknown;
    try {
      await actions.signInPassword(
        makeEvent(
          { identifier: 'ada-blue', password: 'correct horse battery staple' },
          { AUTH_METHODS: 'password' },
          `https://app.test/signin?returnTo=${encodeURIComponent(returnTo)}`
        )
      );
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    return (caught as { location: string }).location;
  }

  it('redirects to a safe returnTo after signing in', async () => {
    expect(await passwordRedirect('/sims')).toBe('/sims');
  });

  it('redirects to / instead of an off-site returnTo', async () => {
    expect(await passwordRedirect('https://evil.example/')).toBe('/');
    expect(await passwordRedirect('//evil.example/')).toBe('/');
  });
});

describe('signin startFresh action', () => {
  it('redirects to /sims when the stash has expired (no pending title)', async () => {
    readPendingSim.mockReturnValue(null);
    let caught: unknown;
    try {
      await actions.startFresh(makeStartFreshEvent());
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims');
    // Nothing to clear or create when the stash was already empty.
    expect(clearPendingSim).not.toHaveBeenCalled();
    expect(createSim).not.toHaveBeenCalled();
    // A fresh identity was minted regardless: "I am not that person" must not leave a
    // stranger's address seeded for whoever looks at /signin next within the window.
    expect(clearPendingIdentifier).toHaveBeenCalled();
  });

  it('reseeds the handle, creates the sim, and redirects into it for a valid stash', async () => {
    readPendingSim.mockReturnValue('Learn to swim');
    createSim.mockResolvedValue({ simId: 'sid-99' });

    let caught: unknown;
    try {
      await actions.startFresh(makeStartFreshEvent());
    } catch (e) {
      caught = e;
    }
    expect(isRedirect(caught)).toBe(true);
    expect((caught as { location: string }).location).toBe('/sims/sid-99');
    expect(clearPendingSim).toHaveBeenCalled();
    expect(reseedHandleFromSim).toHaveBeenCalledWith(
      expect.objectContaining({ identityId: 'pseudo-u1', simTitle: 'Learn to swim' })
    );
    expect(createSim).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Learn to swim', managerId: 'pseudo-u1' })
    );
    expect(clearPendingIdentifier).toHaveBeenCalled();
  });

  it('drops a stashed title that fails the title check and lands on /sims', async () => {
    // The cookie is user-controlled: it gets the same checks as a typed title.
    readPendingSim.mockReturnValue('x'.repeat(SIM_TITLE_MAX + 1));
    let caught: unknown;
    try {
      await actions.startFresh(makeStartFreshEvent());
    } catch (e) {
      caught = e;
    }
    expect((caught as { location: string }).location).toBe('/sims');
    expect(createSim).not.toHaveBeenCalled();
    expect(reseedHandleFromSim).not.toHaveBeenCalled();
    expect(clearPendingSim).toHaveBeenCalled();
  });

  it('mints regardless of the known-device cookie: no known-device gate on this path', async () => {
    // The action never consults the known-device cookie at all; it just mints. This
    // asserts the mint seam is invoked unconditionally, which is the whole point of the
    // escape hatch.
    readPendingSim.mockReturnValue('Learn to swim');
    try {
      await actions.startFresh(makeStartFreshEvent());
    } catch {
      // A redirect throw is expected on success; irrelevant to this assertion.
    }
    expect(mintPseudonymousSession).toHaveBeenCalledTimes(1);
  });

  it('returns fail(status) under startFreshError, never the identifier field key, when the mint seam rejects', async () => {
    readPendingSim.mockReturnValue('Learn to swim');
    mintPseudonymousSession.mockResolvedValue({
      ok: false,
      status: 429,
      message: 'slow down'
    });
    const res = (await actions.startFresh(makeStartFreshEvent())) as ActionFailure<{
      startFreshError: string;
    }>;
    expect(res.status).toBe(429);
    // Exact shape: the message rides its own key so the page never associates a
    // startFresh failure with the sendLink identifier field (aria-invalid).
    expect(res.data).toEqual({ startFreshError: 'slow down' });
    expect(clearPendingSim).not.toHaveBeenCalled();
    expect(createSim).not.toHaveBeenCalled();
    // "I am not that person" is complete the instant the action runs, independent of
    // whether the mint itself succeeds: a rate-limited mint (shared device, IP brake
    // tripped) must not leave the PREVIOUS visitor's address seeded on the re-render.
    expect(clearPendingIdentifier).toHaveBeenCalled();
  });
});
