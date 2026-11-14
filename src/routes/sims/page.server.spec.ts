import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';

const mint = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));

import { createInvite } from '$lib/server/invites/control-plane';
import { createSim } from '$lib/server/sims/sims';
import { actions, load } from './+page.server';
import { load as layoutLoad } from './+layout.server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  mint.mockReset();
});

function setup(
  opts: {
    known?: boolean;
    pending?: string;
    user?: {
      id: string;
      pseudonymous: boolean;
      email?: string;
      emailVerified?: boolean;
    };
  } = {}
) {
  const t = freshDb();
  opened.push(t.close);
  const store = new Map<string, string>();
  if (opts.known) store.set('sfh_known', '1');
  if (opts.pending) store.set('sfh_pending_sim', opts.pending);
  const cookies = {
    get: (n: string) => store.get(n),
    set: (n: string, v: string) => void store.set(n, v),
    delete: (n: string) => void store.delete(n)
  };
  const platform = makePlatform(t.shim);
  const locals = { user: opts.user ?? null };
  const event = (title?: string) =>
    ({
      platform,
      locals,
      // The page reads the invitations from the /sims layout's load.
      parent: () => layoutLoad({ platform, locals } as never),
      cookies,
      request: new Request('http://localhost/sims', {
        method: 'POST',
        body: new URLSearchParams(title === undefined ? {} : { title })
      }),
      url: new URL('http://localhost/sims')
    }) as never;
  return { ...t, store, event };
}

async function redirectOf(fn: () => unknown): Promise<{ status: number; location: string }> {
  try {
    await fn();
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('expected a redirect');
}

describe('/sims create action', () => {
  it('rejects an empty title with 400', async () => {
    const { event } = setup();
    const res = await actions.create(event(''));
    expect(res).toMatchObject({ status: 400, data: { error: SIMS_COPY.titleRequired } });
  });

  it('rejects a 64-character title with 400', async () => {
    const { event } = setup();
    const res = await actions.create(event('x'.repeat(SIM_TITLE_MAX + 1)));
    expect(res).toMatchObject({ status: 400, data: { error: titleTooLong(SIM_TITLE_MAX) } });
  });

  it('sends a signed-out known device to /signin with the stash cookie', async () => {
    const { event, store } = setup({ known: true });
    const r = await redirectOf(() => actions.create(event('Garden')));
    expect(r).toMatchObject({ status: 303, location: '/signin?returnTo=/sims' });
    expect(store.get('sfh_pending_sim')).toBe('Garden');
    expect(mint).not.toHaveBeenCalled();
  });

  it('mints for a fresh visitor, creates the sim, and redirects to it', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
    const r = await redirectOf(() => actions.create(event('Garden')));
    expect(mint).toHaveBeenCalledOnce();
    expect(r.status).toBe(303);
    expect(r.location).toMatch(/^\/sims\/.+/);
  });

  it('answers 403 for a signed-in user at the quota', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    for (let i = 0; i < 5; i++) await createSim({ db, title: `S${i}`, managerId: 'u1' });
    const res = await actions.create(event('More'));
    expect(res).toMatchObject({ status: 403, data: { error: SIMS_COPY.quota } });
  });
});

describe('/sims load', () => {
  it('returns an empty list when signed out', async () => {
    const { event } = setup();
    expect(await load(event())).toEqual({ sims: [], invitations: [] });
  });

  it('lists the user sims sorted by title', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await createSim({ db, title: 'beta', managerId: 'u1' });
    await createSim({ db, title: 'Alpha', managerId: 'u1' });
    const res = (await load(event())) as { sims: { title: string }[] };
    expect(res.sims.map((s) => s.title)).toEqual(['Alpha', 'beta']);
  });

  it('lists the invitations addressed to the user, as { id, simId, simTitle, inviterHandle }', async () => {
    const { db, event } = setup({
      user: { id: 'u1', pseudonymous: false, email: 'u1@test.com', emailVerified: true }
    });
    await seedUser(db, { id: 'u1', email: 'u1@test.com', emailVerified: true });
    await seedUser(db, { id: 'm1', email: 'm1@test.com', handle: 'mara' });
    const { simId } = await createSim({ db, title: 'Garden', managerId: 'm1' });
    await createInvite({
      db,
      simId,
      invitedByUserId: 'm1',
      target: { kind: 'handle', handle: 'u1' },
      canInviteByEmail: true
    });
    const res = (await load(event())) as { invitations: Record<string, unknown>[] };
    expect(res.invitations).toEqual([
      { id: expect.any(String), simId, simTitle: 'Garden', inviterHandle: 'mara' }
    ]);
  });

  it("takes the invitations from the layout's load instead of reading them again", async () => {
    const { event } = setup({ user: { id: 'u1', pseudonymous: false } });
    const fromLayout = [{ id: 'i1', simId: 's1', simTitle: 'Garden', inviterHandle: 'mara' }];
    const e = event() as unknown as Record<string, unknown>;
    e.parent = async () => ({ recipientInvites: fromLayout });
    const res = (await load(e as never)) as { invitations: unknown };
    expect(res.invitations).toBe(fromLayout);
  });

  it('resumes a pending sim: creates it, clears the stash, redirects', async () => {
    const { db, event, store } = setup({
      pending: 'Resumed',
      user: { id: 'u1', pseudonymous: false }
    });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const r = await redirectOf(() => load(event()));
    expect(r.status).toBe(303);
    expect(r.location).toMatch(/^\/sims\/.+/);
    expect(store.has('sfh_pending_sim')).toBe(false);
  });

  it.each([
    ['over-long', 'x'.repeat(SIM_TITLE_MAX + 1)],
    ['empty', '   ']
  ])('creates no sim from an %s stashed title and returns the list', async (_n, pending) => {
    const { db, event, store } = setup({ pending, user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const res = (await load(event())) as { sims: unknown[] };
    expect(res.sims).toEqual([]);
    // A blank stash reads back as absent, so only the over-long one is cleared.
    if (pending.trim()) expect(store.has('sfh_pending_sim')).toBe(false);
  });

  it('clears the stash and lists when the pending sim is over the quota', async () => {
    const { db, event, store } = setup({
      pending: 'Resumed',
      user: { id: 'u1', pseudonymous: false }
    });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    for (let i = 0; i < 5; i++) await createSim({ db, title: `S${i}`, managerId: 'u1' });
    const res = (await load(event())) as { sims: unknown[] };
    expect(res.sims).toHaveLength(5);
    expect(store.has('sfh_pending_sim')).toBe(false);
  });
});
