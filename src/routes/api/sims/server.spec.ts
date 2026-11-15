import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import { freshDb, makePlatform, seedSim, seedUser } from '$lib/server/test/auth-db';

const mint = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));

import { simIndex, user as userTable } from '$lib/server/db/schema';
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
  const call = (body: unknown, headers: Record<string, string | null> = {}) =>
    POST({
      platform: makePlatform(t.shim),
      locals: { user: opts.user ?? null },
      cookies,
      request: new Request('http://localhost/api/sims', {
        method: 'POST',
        headers: Object.fromEntries(
          Object.entries({ 'content-type': 'application/json', ...headers }).filter(
            (e): e is [string, string] => e[1] !== null
          )
        ),
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
    for (let i = 0; i < 5; i++) await seedSim(db, { title: `S${i}`, managerId: 'u1' });
    const res = await call({ title: 'More' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.quota });
  });

  it('answers 401 JSON, not a redirect, for a signed-out known device', async () => {
    const { call, store } = setup({ known: true });
    const res = await call({ title: 'Garden' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: SIMS_COPY.signInRequired });
    expect(store.has('sfh_pending_sim')).toBe(false);
  });

  describe('cross-site requests', () => {
    async function expectNothingCreated(db: Awaited<ReturnType<typeof setup>>['db']) {
      expect(mint).not.toHaveBeenCalled();
      expect(await db.select().from(simIndex)).toEqual([]);
      expect(await db.select().from(userTable)).toEqual([]);
    }

    it('answers 415 when there is no content type', async () => {
      const { db, call } = setup();
      const res = await call({ title: 'Garden' }, { 'content-type': null });
      expect(res.status).toBe(415);
      await expectNothingCreated(db);
    });

    it('answers 415 for text/plain', async () => {
      const { db, call } = setup();
      const res = await call({ title: 'Garden' }, { 'content-type': 'text/plain' });
      expect(res.status).toBe(415);
      await expectNothingCreated(db);
    });

    it('answers 403 for a foreign Origin', async () => {
      const { db, call } = setup();
      const res = await call({ title: 'Garden' }, { origin: 'https://evil.example' });
      expect(res.status).toBe(403);
      await expectNothingCreated(db);
    });

    it('allows the site own Origin and a charset on the content type', async () => {
      const { db, call } = setup();
      await seedUser(db, { id: 'p1', email: 'p1@test.com' });
      mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
      const res = await call(
        { title: 'Garden' },
        { origin: 'http://localhost', 'content-type': 'application/json; charset=utf-8' }
      );
      expect(res.status).toBe(201);
    });
  });
});
