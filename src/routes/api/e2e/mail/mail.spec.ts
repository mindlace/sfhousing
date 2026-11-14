import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { clearE2eMail, recordE2eMail } from '$lib/server/e2e/mail-sink';
import { GET } from './+server';

const platform = { env: { ENVIRONMENT: 'development' } } as unknown as App.Platform;

function event(query: string, p: App.Platform = platform) {
  const url = new URL(`http://localhost/api/e2e/mail${query}`);
  return { platform: p, url } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.stubEnv('VITE_E2E', '1');
  clearE2eMail();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/e2e/mail', () => {
  it('returns the latest recorded link for the kind and address', async () => {
    recordE2eMail(platform, 'password-reset', 'Ann@x.test', 'http://localhost/r/1');
    recordE2eMail(platform, 'password-reset', 'ann@x.test', 'http://localhost/r/2');
    const res = await GET(event('?kind=password-reset&to=ann@x.test'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ url: 'http://localhost/r/2' });
  });

  it('404 when nothing was recorded', async () => {
    const res = await GET(event('?kind=invite&to=nobody@x.test'));
    expect(res.status).toBe(404);
  });

  it('404 for an unknown kind or a missing address', async () => {
    recordE2eMail(platform, 'invite', 'ann@x.test', 'http://localhost/i/1');
    expect((await GET(event('?kind=bogus&to=ann@x.test'))).status).toBe(404);
    expect((await GET(event('?kind=invite'))).status).toBe(404);
  });

  it('404 outside an e2e build', async () => {
    recordE2eMail(platform, 'invite', 'ann@x.test', 'http://localhost/i/1');
    vi.stubEnv('VITE_E2E', '');
    expect((await GET(event('?kind=invite&to=ann@x.test'))).status).toBe(404);
  });

  it('404 in an e2e build outside development', async () => {
    recordE2eMail(platform, 'invite', 'ann@x.test', 'http://localhost/i/1');
    const prod = { env: { ENVIRONMENT: 'production' } } as unknown as App.Platform;
    expect((await GET(event('?kind=invite&to=ann@x.test', prod))).status).toBe(404);
  });
});
