import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';

const mint = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));

import { createSim } from '$lib/server/sims/sims';
import { POST } from './+server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  mint.mockReset();
});

function setup(opts: { known?: boolean; user?: { id: string; pseudonymous: boolean } } = {}) {
  const t = freshDb();
  opened.push(t.close);
  const store = new Map<string, string>();
  if (opts.known) store.set('sfh_known', '1');
  const cookies = {
    get: (n: string) => store.get(n),
    set: (n: string, v: string) => void store.set(n, v),
    delete: (n: string) => void store.delete(n)
  };
  const call = (body: unknown) =>
    POST({
      platform: makePlatform(t.shim),
      locals: { user: opts.user ?? null },
      cookies,
      request: new Request('http://localhost/api/sims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      }),
      url: new URL('http://localhost/api/sims')
    } as never);
  return { ...t, store, call };
}

describe('POST /api/sims', () => {
  it('creates a sim and returns 201 { simId }', async () => {
    const { db, call } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
    const res = await call({ title: 'Garden' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ simId: expect.any(String) });
  });

  it('answers 400 JSON for an empty title', async () => {
    const { call } = setup();
    const res = await call({ title: ' ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SIMS_COPY.titleRequired });
  });

  it('answers 400 JSON for a 64-character title', async () => {
    const { call } = setup();
    const res = await call({ title: 'x'.repeat(SIM_TITLE_MAX + 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: titleTooLong(SIM_TITLE_MAX) });
  });

  it('answers 400 JSON for a body that is not JSON', async () => {
    const { call } = setup();
    const res = await call('not json');
    expect(res.status).toBe(400);
  });

  it('answers 403 JSON at the quota', async () => {
    const { db, call } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    for (let i = 0; i < 5; i++) await createSim({ db, title: `S${i}`, managerId: 'u1' });
    const res = await call({ title: 'More' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.quota });
  });

  it('answers 401 JSON, not a redirect, for a signed-out known device', async () => {
    const { call, store } = setup({ known: true });
    const res = await call({ title: 'Garden' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: SIMS_COPY.signInRequired });
    expect(store.get('sfh_pending_sim')).toBe('Garden');
  });
});
