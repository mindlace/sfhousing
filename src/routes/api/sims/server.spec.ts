import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import { DEFAULT_SIM_NAME } from '$lib/sim-log';
import { newId } from '$lib/server/ids/factory';
import {
  freshDb,
  makePlatform,
  seedManagedSims,
  seedSim,
  seedUser
} from '$lib/server/test/auth-db';

const mint = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));

import { simIndex, simTakedown, user as userTable } from '$lib/server/db/schema';
import { addMemberById, getRole, getSimTitle } from '$lib/server/sims/sim-index';
import { removeSimMember } from '$lib/server/sims/sims';
import { POST } from './+server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  mint.mockReset();
});

function setup(
  opts: {
    known?: boolean;
    user?: { id: string; pseudonymous: boolean };
    env?: Record<string, unknown>;
  } = {}
) {
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
      // development: the creation limiter allows without a binding (and logs nothing).
      platform: makePlatform(t.shim, { ENVIRONMENT: 'development', ...opts.env }),
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

const taken = { error: SIMS_COPY.notYours, code: 'taken' };

describe('POST /api/sims', () => {
  it('registers a new id: 201 { simId, created: true }', async () => {
    const { db, call } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
    const simId = newId();
    const res = await call({ simId, title: 'Garden' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ simId, created: true });
    expect(await getRole({ db, simId, userId: 'p1' })).toBe('manager');
  });

  it('a second post by the same signed-in caller: 200 { simId, created: false }', async () => {
    const { db, call } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const simId = newId();
    expect((await call({ simId, title: 'Garden' })).status).toBe(201);
    const again = await call({ simId, title: 'Garden' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ simId, created: false });
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['no simId', { title: 'Garden' }],
    ['a simId that is not a string', { simId: 7, title: 'Garden' }],
    ['a simId that is not a valid id', { simId: 'nope', title: 'Garden' }],
    ['a JSON body that is not an object', '"text"']
  ])('answers 400 invalid_id for %s', async (_name, body) => {
    const { db, call } = setup();
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SIMS_COPY.invalidId, code: 'invalid_id' });
    expect(mint).not.toHaveBeenCalled();
    expect(await db.select().from(simIndex)).toEqual([]);
  });

  it('answers 400 title for an empty title', async () => {
    const { call } = setup();
    const res = await call({ simId: newId(), title: ' ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SIMS_COPY.titleRequired, code: 'title' });
  });

  it('answers 400 title for a 64-character title', async () => {
    const { call } = setup();
    const res = await call({ simId: newId(), title: 'x'.repeat(SIM_TITLE_MAX + 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: titleTooLong(SIM_TITLE_MAX), code: 'title' });
  });

  it('answers 400 title for a title that is not a string', async () => {
    const { call } = setup();
    const res = await call({ simId: newId(), title: 7 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SIMS_COPY.titleRequired, code: 'title' });
    expect(mint).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['absent', undefined]
  ])('a title that is %s gets the default name', async (_name, title) => {
    const { db, call } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const simId = newId();
    const res = await call({ simId, title });
    expect(res.status).toBe(201);
    expect(await getSimTitle({ db, simId })).toBe(DEFAULT_SIM_NAME);
  });

  it('answers 401 sign_in, not a redirect, for a signed-out known device, and mints nothing', async () => {
    const { call, store } = setup({ known: true });
    const res = await call({ simId: newId(), title: 'Garden' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: SIMS_COPY.signInRequired, code: 'sign_in' });
    expect(store.has('sfh_pending_sim')).toBe(false);
    expect(mint).not.toHaveBeenCalled();
  });

  it('signed out, an id in use: 409 taken, and nothing is minted', async () => {
    const { db, call } = setup();
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    const simId = await seedSim(db, { title: 'Theirs', managerId: 'm1', simId: newId() });
    const res = await call({ simId, title: 'Mine' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(taken);
    expect(mint).not.toHaveBeenCalled();
    expect(await db.select().from(userTable)).toHaveLength(1);
  });

  it('signed out, a taken-down id: 409 taken, and nothing is minted', async () => {
    const { db, call } = setup();
    const simId = newId();
    await db.insert(simTakedown).values({ simId, takenDownAt: new Date() });
    const res = await call({ simId });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(taken);
    expect(mint).not.toHaveBeenCalled();
  });

  it('answers 429 rate when the mint is refused, and 500 session when it fails', async () => {
    const { call } = setup();
    mint.mockResolvedValue({ ok: false, status: 429, message: SIMS_COPY.tooManySims });
    const refused = await call({ simId: newId() });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: SIMS_COPY.tooManySims, code: 'rate' });
    mint.mockResolvedValue({ ok: false, status: 500, message: SIMS_COPY.sessionStart });
    const failed = await call({ simId: newId() });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: SIMS_COPY.sessionStart, code: 'session' });
  });

  it('answers 429 rate when the identity is over the creation limit', async () => {
    const { db, call } = setup({
      user: { id: 'u1', pseudonymous: false },
      env: {
        ENVIRONMENT: 'production',
        MUTATION_REGISTERED_RL: { limit: async () => ({ success: false }) }
      }
    });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const res = await call({ simId: newId(), title: 'Fast' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: SIMS_COPY.tooManySims, code: 'rate' });
    expect(await db.select().from(simIndex)).toEqual([]);
  });

  it('answers 403 quota for a new id at the cap', async () => {
    const { db, call } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedManagedSims(db, { managerId: 'u1', count: 1000 });
    const res = await call({ simId: newId(), title: 'More' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.quota, code: 'quota' });
  });

  it('a reader of the id: 409 taken, and still a reader', async () => {
    const { db, call } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    const simId = await seedSim(db, { title: 'Shared', managerId: 'm1', simId: newId() });
    await addMemberById({ db, simId, userId: 'u1', role: 'viewer' });
    const res = await call({ simId, title: 'Mine' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(taken);
    expect(await getRole({ db, simId, userId: 'u1' })).toBe('viewer');
  });

  it('a sim with no members: 409 taken for its former manager', async () => {
    const { db, call } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const simId = await seedSim(db, { title: 'Kept', managerId: 'u1', simId: newId() });
    await removeSimMember({ db, env: undefined, simId, userId: 'u1' });
    const res = await call({ simId, title: 'Kept' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(taken);
    expect(await getRole({ db, simId, userId: 'u1' })).toBeNull();
  });

  describe('cross-site requests', () => {
    async function expectNothingCreated(db: Awaited<ReturnType<typeof setup>>['db']) {
      expect(mint).not.toHaveBeenCalled();
      expect(await db.select().from(simIndex)).toEqual([]);
      expect(await db.select().from(userTable)).toEqual([]);
    }

    it('answers 415 when there is no content type', async () => {
      const { db, call } = setup();
      const res = await call({ simId: newId(), title: 'Garden' }, { 'content-type': null });
      expect(res.status).toBe(415);
      await expectNothingCreated(db);
    });

    it('answers 415 for text/plain', async () => {
      const { db, call } = setup();
      const res = await call({ simId: newId(), title: 'Garden' }, { 'content-type': 'text/plain' });
      expect(res.status).toBe(415);
      await expectNothingCreated(db);
    });

    it('answers 403 for a foreign Origin', async () => {
      const { db, call } = setup();
      const res = await call(
        { simId: newId(), title: 'Garden' },
        { origin: 'https://evil.example' }
      );
      expect(res.status).toBe(403);
      await expectNothingCreated(db);
    });

    it('allows the site own Origin and a charset on the content type', async () => {
      const { db, call } = setup();
      await seedUser(db, { id: 'p1', email: 'p1@test.com' });
      mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
      const res = await call(
        { simId: newId(), title: 'Garden' },
        { origin: 'http://localhost', 'content-type': 'application/json; charset=utf-8' }
      );
      expect(res.status).toBe(201);
    });
  });
});
