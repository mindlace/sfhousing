import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import { user as userTable } from '$lib/server/db/schema';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';

const mint = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));

import { listSimsForUser } from './sim-index';
import { createSim } from './sims';
import { startSim } from './start-sim';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  mint.mockReset();
});

function setup(
  opts: { known?: boolean; user?: { id: string; pseudonymous: boolean } | null } = {}
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
  const event = {
    platform: makePlatform(t.shim),
    locals: { user: opts.user ?? null },
    cookies,
    request: new Request('http://localhost/sims'),
    url: new URL('http://localhost/sims')
  } as unknown as RequestEvent;
  return { ...t, store, event };
}

describe('startSim', () => {
  it('rejects an empty title with 400', async () => {
    const { event } = setup();
    const res = await startSim(event, '   ');
    expect(res).toMatchObject({ status: 400, data: { error: SIMS_COPY.titleRequired } });
    expect(mint).not.toHaveBeenCalled();
  });

  it('rejects a title over the limit with 400', async () => {
    const { event } = setup();
    const res = await startSim(event, 'x'.repeat(SIM_TITLE_MAX + 1));
    expect(res).toMatchObject({ status: 400, data: { error: titleTooLong(SIM_TITLE_MAX) } });
  });

  it('accepts a title at the limit', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: false } });
    const res = await startSim(event, 'y'.repeat(SIM_TITLE_MAX));
    expect(res).toHaveProperty('simId');
  });

  it('sends a signed-out known device to /signin and stashes the title', async () => {
    const { event, store } = setup({ known: true });
    let thrown: unknown;
    try {
      await startSim(event, ' Garden ');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ status: 303, location: '/signin?returnTo=/sims' });
    expect(store.get('sfh_pending_sim')).toBe('Garden');
    expect(mint).not.toHaveBeenCalled();
  });

  it('mints for a fresh visitor, reseeds the handle, and creates the sim', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com', handle: 'placeholder' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
    const res = await startSim(event, 'Sunset Homes');
    expect(mint).toHaveBeenCalledOnce();
    expect(res).toHaveProperty('simId');
    const listed = await listSimsForUser({ db, userId: 'p1' });
    expect(listed).toEqual([
      { simId: (res as { simId: string }).simId, title: 'Sunset Homes', role: 'manager' }
    ]);
    const [row] = await db.select().from(userTable).where(eq(userTable.userIdentity, 'p1'));
    expect(row.handle).not.toBe('placeholder');
  });

  it('passes a mint failure through with its status', async () => {
    const { event } = setup();
    mint.mockResolvedValue({ ok: false, status: 429, message: SIMS_COPY.tooManySims });
    const res = await startSim(event, 'Sim');
    expect(res).toMatchObject({ status: 429, data: { error: SIMS_COPY.tooManySims } });
  });

  it('does not reseed the handle of a signed-in user who already has a sim', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: true } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com', handle: 'keepme' });
    await createSim({ db, title: 'First', managerId: 'u1' });
    const res = await startSim(event, 'Second');
    expect(res).toHaveProperty('simId');
    expect(mint).not.toHaveBeenCalled();
    const [row] = await db.select().from(userTable).where(eq(userTable.userIdentity, 'u1'));
    expect(row.handle).toBe('keepme');
  });

  it('answers 403 with the quota copy at the cap', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    for (let i = 0; i < 5; i++) await createSim({ db, title: `S${i}`, managerId: 'u1' });
    const res = await startSim(event, 'One more');
    expect(res).toMatchObject({ status: 403, data: { error: SIMS_COPY.quota } });
  });
});
