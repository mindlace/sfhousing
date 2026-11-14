import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SIMS_COPY } from '$lib/members/copy';
import { POST } from './+server';

vi.mock('$lib/server/email/validate', () => ({ isValidEmail: (e: string) => e.includes('@') }));
vi.mock('$lib/server/security/rate-limit', () => ({ enforceRate: vi.fn(async () => true) }));

// The magic-link verify URL the fake sendMagicLink hands to captureMagicLink. The option is
// only ever wired by the caller in an e2e env (isE2eEnv).
const MAGIC_VERIFY_URL = 'https://app.test/api/auth/magic-link/verify?token=xyz';
let lastAuthOpts: { captureMagicLink?: (m: { email: string; url: string }) => void } | undefined;
const signInMagicLink = vi.fn(async (args: { body: { email: string } }) => {
  lastAuthOpts?.captureMagicLink?.({ email: args.body.email, url: MAGIC_VERIFY_URL });
});
vi.mock('$lib/server/auth/better-auth', () => ({
  authFor: (
    _event: unknown,
    opts?: { captureMagicLink?: (m: { email: string; url: string }) => void }
  ) => {
    lastAuthOpts = opts;
    return { api: { signInMagicLink } };
  }
}));

// A non-e2e test build: `import.meta.env.VITE_E2E` is unset, so isE2eEnv is false and no
// devLink sink is wired. The e2e case stubs the flag on and sets ENVIRONMENT=development.
const platform = { env: { AUTH_LINK_RL: {} } } as unknown as App.Platform;
const e2ePlatform = {
  env: { AUTH_LINK_RL: {}, ENVIRONMENT: 'development' }
} as unknown as App.Platform;

function evt(
  bodyObj: unknown,
  user: unknown = { id: 'u1', handle: 'ada', pseudonymous: true },
  plt: App.Platform = platform,
  headers: Record<string, string> = {}
) {
  return {
    locals: { user },
    platform: plt,
    url: new URL('http://localhost/api/account/email/verify'),
    request: new Request('http://localhost/api/account/email/verify', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'content-type': 'application/json', ...headers },
      body: JSON.stringify(bodyObj)
    })
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  lastAuthOpts = undefined;
});

describe('POST /api/account/email/verify', () => {
  it('sends magic link with callbackURL "/" and returns emailSent', async () => {
    const res = await POST(evt({ email: 'a@b.com' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailSent).toBe(true);
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ callbackURL: '/' }) })
    );
  });

  it('400 on malformed email', async () => {
    const res = await POST(evt({ email: 'nope' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailError).toBeTruthy();
  });

  it('400 when already registered (not pseudonymous)', async () => {
    const res = await POST(
      evt({ email: 'a@b.com' }, { id: 'u1', handle: 'ada', pseudonymous: false })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailError).toBeTruthy();
  });

  it('401 when not signed in', async () => {
    const res = await POST(evt({ email: 'a@b.com' }, null));
    expect(res.status).toBe(401);
  });

  it('429 when IP rate limit exceeded', async () => {
    const { enforceRate } = await import('$lib/server/security/rate-limit');
    vi.mocked(enforceRate).mockResolvedValueOnce(false);
    const res = await POST(evt({ email: 'a@b.com' }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailError).toBeTruthy();
  });

  it('still returns emailSent when email rate limit exceeded (silent throttle)', async () => {
    const { enforceRate } = await import('$lib/server/security/rate-limit');
    vi.mocked(enforceRate)
      .mockResolvedValueOnce(true) // IP limit passes
      .mockResolvedValueOnce(false); // email limit fails (silent)
    const res = await POST(evt({ email: 'a@b.com' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailSent).toBe(true);
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('no devLink outside an e2e env', async () => {
    const res = await POST(evt({ email: 'a@b.com' }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.devLink).toBeUndefined();
  });

  it('surfaces devLink in an e2e env', async () => {
    vi.stubEnv('VITE_E2E', '1');
    const res = await POST(evt({ email: 'a@b.com' }, undefined, e2ePlatform));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.devLink).toBe(MAGIC_VERIFY_URL);
  });

  it('415 and no link sent when the body is not JSON', async () => {
    const res = await POST(
      evt({ email: 'a@b.com' }, undefined, platform, { 'content-type': 'text/plain' })
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('403 and no link sent for a foreign Origin', async () => {
    const res = await POST(
      evt({ email: 'a@b.com' }, undefined, platform, { origin: 'https://evil.example' })
    );
    expect(res.status).toBe(403);
    expect(signInMagicLink).not.toHaveBeenCalled();
  });
});
