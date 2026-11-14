import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SIMS_COPY } from '$lib/members/copy';
import { PATCH } from './+server';

vi.mock('$lib/server/email/validate', () => ({ isValidEmail: (e: string) => e.includes('@') }));
vi.mock('$lib/server/security/rate-limit', () => ({ enforceRate: vi.fn(async () => true) }));

const changeEmail = vi.fn(async () => {});
vi.mock('$lib/server/auth/better-auth', () => ({ authFor: () => ({ api: { changeEmail } }) }));

/** SES keys: a mail provider is configured, so magic link is in effect. */
const MAIL = { SES_ACCESS_KEY_ID: 'key-id', SES_SECRET_ACCESS_KEY: 'secret' };
const platform = { env: { AUTH_LINK_RL: {}, ...MAIL } } as unknown as App.Platform;

function evt(
  bodyObj: unknown,
  user: unknown = { id: 'u1', handle: 'ada' },
  headers: Record<string, string> = {}
) {
  return {
    locals: { user },
    platform,
    url: new URL('http://localhost/api/account/email'),
    request: new Request('http://localhost/api/account/email', {
      method: 'PATCH',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'content-type': 'application/json', ...headers },
      body: JSON.stringify(bodyObj)
    })
  } as unknown as Parameters<typeof PATCH>[0];
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/account/email', () => {
  it('sends change email with callbackURL "/" and returns emailChangeSent', async () => {
    const res = await PATCH(evt({ email: 'new@email.com' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailChangeSent).toBe(true);
    expect(body.email).toBe('new@email.com');
    expect(changeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ callbackURL: '/' }) })
    );
  });

  it('404 and no change email when no mail provider is configured', async () => {
    const event = evt({ email: 'new@email.com' });
    (event as { platform: App.Platform }).platform = {
      env: { AUTH_LINK_RL: {} }
    } as unknown as App.Platform;
    let caught: unknown;
    try {
      await PATCH(event);
    } catch (e) {
      caught = e;
    }
    expect((caught as { status: number }).status).toBe(404);
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('400 on malformed email', async () => {
    const res = await PATCH(evt({ email: 'nope' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.changeError).toBeTruthy();
  });

  it('401 when not signed in', async () => {
    const res = await PATCH(evt({ email: 'new@email.com' }, null));
    expect(res.status).toBe(401);
  });

  it('429 when IP rate limit exceeded', async () => {
    const { enforceRate } = await import('$lib/server/security/rate-limit');
    vi.mocked(enforceRate).mockResolvedValueOnce(false);
    const res = await PATCH(evt({ email: 'new@email.com' }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.changeError).toBeTruthy();
  });

  it('415 and no change email when the body is not JSON', async () => {
    const res = await PATCH(
      evt({ email: 'new@email.com' }, undefined, { 'content-type': 'text/plain' })
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('403 and no change email for a foreign Origin', async () => {
    const res = await PATCH(
      evt({ email: 'new@email.com' }, undefined, { origin: 'https://evil.example' })
    );
    expect(res.status).toBe(403);
    expect(changeEmail).not.toHaveBeenCalled();
  });
});
