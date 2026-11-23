import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const { getAuth, getSession, resolveSessionUser } = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getSession: vi.fn(),
  resolveSessionUser: vi.fn()
}));
vi.mock('$lib/server/auth/better-auth', () => ({ getAuth }));
vi.mock('$lib/server/user-store/user', () => ({ resolveSessionUser }));

// @ts-expect-error -- SvelteKit's internal server entry ships no module typings.
import { with_request_store } from '@sveltejs/kit/internal/server';
import { handle, headersHandle, sessionHandle } from './hooks.server';

type StoreRunner = (store: unknown, fn: () => Promise<Response>) => Promise<Response>;

// `sequence` reads SvelteKit's per-request store, which only the server runtime sets. Run the
// composed handle inside a minimal store (no tracing) as the runtime would.
async function inRequestStore(e: RequestEvent, fn: () => Promise<Response>): Promise<Response> {
  const tracing = { record_span: ({ fn }: { fn: (span: unknown) => unknown }) => fn({}) };
  return (with_request_store as StoreRunner)({ event: e, state: { tracing } }, fn);
}

const SECRET = 'a'.repeat(64);
const PUBLIC_LOCALS = { user: null, session: null };
const ALICE = { id: 'ident-1', email: 'alice@example.com', handle: 'alice' };

function event(
  path: string,
  opts: { cookie?: string; upgrade?: string; env?: Record<string, unknown> } = {}
): RequestEvent {
  const url = new URL(`http://localhost${path}`);
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.upgrade) headers.set('upgrade', opts.upgrade);
  return {
    url,
    request: new Request(url, { headers }),
    platform: { env: opts.env ?? { DB: {}, BETTER_AUTH_SECRET: SECRET } },
    locals: {}
  } as unknown as RequestEvent;
}

const ok = async () => new Response('ok');

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(null);
  getAuth.mockReturnValue({ api: { getSession } });
  resolveSessionUser.mockResolvedValue(ALICE);
});

describe('sessionHandle', () => {
  it('does not construct Better-Auth for a signed-out page', async () => {
    for (const path of ['/', '/sim', '/s/abc', '/p/abc']) {
      const e = event(path);
      const res = await sessionHandle({ event: e, resolve: ok });
      expect(res.status).toBe(200);
      expect(e.locals).toEqual(PUBLIC_LOCALS);
    }
    expect(getAuth).not.toHaveBeenCalled();
    expect(resolveSessionUser).not.toHaveBeenCalled();
  });

  it('works with no BETTER_AUTH_SECRET on a signed-out page', async () => {
    const actual = await vi.importActual<typeof import('$lib/server/auth/better-auth')>(
      '$lib/server/auth/better-auth'
    );
    getAuth.mockImplementation(actual.getAuth);
    const res = await sessionHandle({ event: event('/', { env: { DB: {} } }), resolve: ok });
    expect(res.status).toBe(200);
    // The same env does break an auth route: the real getAuth refuses the missing secret.
    await expect(
      sessionHandle({ event: event('/signin', { env: { DB: {} } }), resolve: ok })
    ).rejects.toThrow();
  });

  it('never resolves a session under /data/, even with a cookie', async () => {
    const e = event('/data/fixture-0/manifest.json', { cookie: 'better-auth.session_token=t' });
    await sessionHandle({ event: e, resolve: ok });
    expect(getAuth).not.toHaveBeenCalled();
    expect(resolveSessionUser).not.toHaveBeenCalled();
    expect(e.locals).toEqual(PUBLIC_LOCALS);
  });

  it('a resolved session sets exactly user and session', async () => {
    getSession.mockResolvedValue({
      user: { id: 'live-1' },
      session: { id: 'sess-1', userId: 'live-1' }
    });
    const e = event('/', { cookie: 'better-auth.session_token=t' });
    await sessionHandle({ event: e, resolve: ok });
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(resolveSessionUser).toHaveBeenCalledWith(expect.anything(), 'live-1');
    expect(e.locals).toEqual({ user: ALICE, session: { id: 'sess-1', userId: 'live-1' } });
  });

  it('recognises the __Secure- cookie name', async () => {
    const e = event('/', { cookie: '__Secure-better-auth.session_token=t' });
    await sessionHandle({ event: e, resolve: ok });
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledWith({ headers: e.request.headers });
  });

  it('constructs Better-Auth on auth routes without a cookie', async () => {
    const e = event('/signin');
    await sessionHandle({ event: e, resolve: ok });
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(getAuth).toHaveBeenCalledWith(e.platform, 'http://localhost');
    expect(e.locals).toEqual(PUBLIC_LOCALS);
  });

  it('reads the session with the request headers only, even on an upgrade request', async () => {
    const e = event('/', { cookie: 'better-auth.session_token=t', upgrade: 'WebSocket' });
    await sessionHandle({ event: e, resolve: ok });
    expect(getSession).toHaveBeenCalledWith({ headers: e.request.headers });
  });

  it('treats a deleted identity as public: locals are exactly { user: null, session: null }', async () => {
    getSession.mockResolvedValue({
      user: { id: 'live-1' },
      session: { id: 'sess-1', userId: 'live-1' }
    });
    resolveSessionUser.mockResolvedValue(null);
    const e = event('/', { cookie: 'better-auth.session_token=t' });
    await sessionHandle({ event: e, resolve: ok });
    expect(e.locals).toEqual(PUBLIC_LOCALS);
  });
});

describe('handle', () => {
  it('runs the session handle before the header handle', async () => {
    getSession.mockResolvedValue({
      user: { id: 'live-1' },
      session: { id: 'sess-1', userId: 'live-1' }
    });
    let seen: unknown = undefined;
    const e = event('/', { cookie: 'better-auth.session_token=t' });
    const res = await inRequestStore(e, async () =>
      handle({
        event: e,
        resolve: async (ev) => {
          seen = ev.locals.user;
          return new Response('ok');
        }
      })
    );
    expect(seen).toEqual(ALICE);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('headersHandle', () => {
  it('passes a 101 upgrade through untouched', async () => {
    // Node cannot construct a status-101 Response; the stand-in's headers throw, as a real 101's do.
    const upgrade = {
      status: 101,
      headers: {
        get: () => null,
        set: () => {
          throw new TypeError('immutable');
        }
      }
    } as unknown as Response;
    expect(await headersHandle({ event: {} as never, resolve: async () => upgrade })).toBe(upgrade);
  });

  it('sets security headers', async () => {
    const response = await headersHandle({
      event: {} as never,
      resolve: async () => new Response('ok')
    });
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets headers on responses with immutable headers', async () => {
    const response = await headersHandle({
      event: {} as never,
      resolve: async () => Response.redirect('https://example.com/', 302)
    });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('location')).toBe('https://example.com/');
  });

  it('keeps every set-cookie on the immutable-headers re-wrap', async () => {
    const response = await headersHandle({
      event: {} as never,
      resolve: async () => {
        const res = new Response('ok');
        res.headers.append('set-cookie', 'a=1; Path=/');
        res.headers.append('set-cookie', 'b=2; Path=/');
        // Emulate immutable headers: set() throws, so the handle re-wraps the response.
        res.headers.set = () => {
          throw new TypeError('immutable');
        };
        return res;
      }
    });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  describe('cache-control default for HTML', () => {
    const run = (resolve: () => Response) =>
      headersHandle({ event: {} as never, resolve: async () => resolve() });
    const html = (cc?: string) =>
      new Response('<p>x</p>', {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          ...(cc ? { 'cache-control': cc } : {})
        }
      });

    it('defaults text/html without cache-control to private, no-cache', async () => {
      expect((await run(() => html())).headers.get('cache-control')).toBe('private, no-cache');
    });

    it('leaves an explicit text/html cache-control unchanged', async () => {
      const r = await run(() => html('private, max-age=300'));
      expect(r.headers.get('cache-control')).toBe('private, max-age=300');
    });

    it('leaves application/json public caching unchanged', async () => {
      const r = await run(
        () =>
          new Response('{}', {
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }
          })
      );
      expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
    });

    it('leaves immutable binary responses unchanged', async () => {
      const cc = 'public, max-age=31536000, immutable';
      const r = await run(
        () =>
          new Response(new Uint8Array(2), {
            headers: { 'content-type': 'application/octet-stream', 'cache-control': cc }
          })
      );
      expect(r.headers.get('cache-control')).toBe(cc);
    });

    it('leaves a text/plain 404 with max-age=60 unchanged', async () => {
      const r = await run(
        () =>
          new Response('nf', {
            status: 404,
            headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=60' }
          })
      );
      expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    });

    it('does not add cache-control to non-HTML responses without one', async () => {
      const r = await run(() => new Response('x', { headers: { 'content-type': 'text/plain' } }));
      expect(r.headers.get('cache-control')).toBeNull();
    });

    it('defaults HTML on the immutable-headers re-wrap path', async () => {
      const r = await run(() => {
        const res = html();
        // Emulate immutable headers: set() throws, so handle re-wraps the response.
        res.headers.set = () => {
          throw new TypeError('immutable');
        };
        return res;
      });
      expect(r.headers.get('cache-control')).toBe('private, no-cache');
    });
  });
});
