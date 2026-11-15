import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import { DEFAULT_SIM_NAME } from '$lib/sim-log';
import { capabilityEvent, simIndex, user as userTable } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';
import {
  freshDb,
  makePlatform,
  seedManagedSims,
  seedSim,
  seedUser
} from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';

const mint = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));
// createSim stays real unless a case makes it throw: before it writes (`with`), or after its
// batch committed (`after`).
const createFails = vi.hoisted(() => ({
  with: null as Error | null,
  after: null as Error | null,
  env: [] as unknown[]
}));
vi.mock('./sims', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sims')>();
  return {
    ...real,
    createSim: async (args: Parameters<typeof real.createSim>[0]) => {
      createFails.env.push(args.env);
      if (createFails.with) throw createFails.with;
      const result = await real.createSim(args);
      if (createFails.after) throw createFails.after;
      return result;
    }
  };
});
// The handle reseed stays real; a case can count its calls or make it throw.
const reseed = vi.hoisted(() => ({ calls: 0, fails: null as Error | null }));
vi.mock('$lib/server/user-store/identity', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/server/user-store/identity')>();
  return {
    ...real,
    reseedHandleFromSim: async (a: Parameters<typeof real.reseedHandleFromSim>[0]) => {
      reseed.calls++;
      if (reseed.fails) throw reseed.fails;
      return real.reseedHandleFromSim(a);
    }
  };
});

import { addMemberById, getRole, getSimTitle, listSimsForUser } from './sim-index';
import { removeSimMember } from './sims';
import { startSim } from './start-sim';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  mint.mockReset();
  createFails.with = null;
  createFails.after = null;
  createFails.env = [];
  reseed.calls = 0;
  reseed.fails = null;
});

function setup(
  opts: {
    known?: boolean;
    user?: { id: string; pseudonymous: boolean } | null;
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
  const event = {
    // development: the creation limiter allows without a binding (and logs nothing).
    platform: makePlatform(t.shim, { ENVIRONMENT: 'development', ...opts.env }),
    locals: { user: opts.user ?? null },
    cookies,
    request: new Request('http://localhost/sims'),
    url: new URL('http://localhost/sims')
  } as unknown as RequestEvent;
  return { ...t, store, event };
}

/** Every ledger event naming the sim. */
async function ledgerOf(db: ReturnType<typeof freshDb>['db'], simId: string) {
  return db
    .select({ principalId: capabilityEvent.principalId, action: capabilityEvent.action })
    .from(capabilityEvent)
    .where(eq(capabilityEvent.resourceId, simId));
}

const taken = { status: 409, data: { error: SIMS_COPY.notYours, code: 'taken' } };

describe('startSim', () => {
  it("passes the request's platform env to createSim", async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await startSim(event, { simId: newId(), title: 'Env' });
    expect(createFails.env).toEqual([event.platform!.env]);
  });

  it('refuses an id that is not valid with 400 invalid_id, and mints nothing', async () => {
    const { event } = setup();
    const res = await startSim(event, { simId: 'not-an-id', title: 'Garden' });
    expect(res).toMatchObject({
      status: 400,
      data: { error: SIMS_COPY.invalidId, code: 'invalid_id' }
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it('rejects an empty title with 400', async () => {
    const { event } = setup();
    const res = await startSim(event, { simId: newId(), title: '   ' });
    expect(res).toMatchObject({
      status: 400,
      data: { error: SIMS_COPY.titleRequired, code: 'title' }
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it('rejects a title over the limit with 400', async () => {
    const { event } = setup();
    const res = await startSim(event, { simId: newId(), title: 'x'.repeat(SIM_TITLE_MAX + 1) });
    expect(res).toMatchObject({
      status: 400,
      data: { error: titleTooLong(SIM_TITLE_MAX), code: 'title' }
    });
  });

  it('accepts a title at the limit', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: false } });
    const simId = newId();
    const res = await startSim(event, { simId, title: 'y'.repeat(SIM_TITLE_MAX) });
    expect(res).toEqual({ simId, created: true });
  });

  it('sends a signed-out known device to /signin and stashes the title', async () => {
    const { event, store } = setup({ known: true });
    let thrown: unknown;
    try {
      await startSim(event, { simId: newId(), title: ' Garden ' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ status: 303, location: '/signin?returnTo=/sims' });
    expect(store.get('sfh_pending_sim')).toBe('Garden');
    expect(mint).not.toHaveBeenCalled();
  });

  it('mints for a fresh visitor, reseeds the handle once, and creates the sim', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com', handle: 'placeholder' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
    const simId = newId();
    const res = await startSim(event, { simId, title: 'Sunset Homes' });
    expect(mint).toHaveBeenCalledOnce();
    expect(res).toEqual({ simId, created: true });
    expect(await listSimsForUser({ db, userId: 'p1' })).toEqual([
      { simId, title: 'Sunset Homes', role: 'manager' }
    ]);
    expect(reseed.calls).toBe(1);
    const [row] = await db.select().from(userTable).where(eq(userTable.userIdentity, 'p1'));
    expect(row.handle).not.toBe('placeholder');
  });

  it('with no title, names the sim the default name and does not reseed the handle', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'p1', email: 'p1@test.com', handle: 'placeholder' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: true } });
    const simId = newId();
    expect(await startSim(event, { simId })).toEqual({ simId, created: true });
    expect(await getSimTitle({ db, simId })).toBe(DEFAULT_SIM_NAME);
    expect(reseed.calls).toBe(0);
    const [row] = await db.select().from(userTable).where(eq(userTable.userIdentity, 'p1'));
    expect(row.handle).toBe('placeholder');
  });

  it("reseeds a signed-in pseudonymous person's handle at their first sim", async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: true } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com', handle: 'placeholder' });
    const simId = newId();
    expect(await startSim(event, { simId, title: 'Sunset Homes' })).toEqual({
      simId,
      created: true
    });
    expect(reseed.calls).toBe(1);
    const [row] = await db.select().from(userTable).where(eq(userTable.userIdentity, 'u1'));
    expect(row.handle).not.toBe('placeholder');
  });

  it('signed out, an id in use: 409 taken, and nothing is minted', async () => {
    const { db, event } = setup();
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    const simId = await seedSim(db, { title: 'Theirs', managerId: 'm1' });
    expect(await startSim(event, { simId, title: 'Mine' })).toMatchObject(taken);
    expect(mint).not.toHaveBeenCalled();
  });

  it('passes a mint failure through with its status and code', async () => {
    const { event } = setup();
    mint.mockResolvedValue({ ok: false, status: 429, message: SIMS_COPY.tooManySims });
    expect(await startSim(event, { simId: newId(), title: 'Sim' })).toMatchObject({
      status: 429,
      data: { error: SIMS_COPY.tooManySims, code: 'rate' }
    });
    mint.mockResolvedValue({ ok: false, status: 500, message: SIMS_COPY.sessionStart });
    expect(await startSim(event, { simId: newId(), title: 'Sim' })).toMatchObject({
      status: 500,
      data: { error: SIMS_COPY.sessionStart, code: 'session' }
    });
  });

  it('a writer registering its own id again: a no-op, even at the quota', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const [simId] = await seedManagedSims(db, { managerId: 'u1', count: 1000 });
    const before = await ledgerOf(db, simId);
    expect(await startSim(event, { simId, title: 'Again' })).toEqual({ simId, created: false });
    expect(await ledgerOf(db, simId)).toEqual(before);
    expect(await getSimTitle({ db, simId })).toBe('Sim 0');
  });

  it('an editor registering the id: a no-op', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    const simId = await seedSim(db, { title: 'Shared', managerId: 'm1' });
    await addMemberById({ db, simId, userId: 'u1', role: 'editor' });
    expect(await startSim(event, { simId, title: 'Shared' })).toEqual({ simId, created: false });
    expect(await getRole({ db, simId, userId: 'u1' })).toBe('editor');
  });

  it('a viewer registering the id: 409 taken, and still a viewer', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    const simId = await seedSim(db, { title: 'Shared', managerId: 'm1' });
    await addMemberById({ db, simId, userId: 'u1', role: 'viewer' });
    const before = await ledgerOf(db, simId);
    expect(await startSim(event, { simId, title: 'Mine' })).toMatchObject(taken);
    expect(await getRole({ db, simId, userId: 'u1' })).toBe('viewer');
    expect(await ledgerOf(db, simId)).toEqual(before);
  });

  it("someone else's sim, no role at all: 409 taken, and nothing granted", async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    const simId = await seedSim(db, { title: 'Theirs', managerId: 'm1' });
    expect(await startSim(event, { simId, title: 'Mine' })).toMatchObject(taken);
    expect(await getRole({ db, simId, userId: 'u1' })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([{ principalId: 'm1', action: 'grant' }]);
  });

  it('a sim with no members: its former manager gets 409 taken', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const simId = await seedSim(db, { title: 'Kept', managerId: 'u1' });
    await removeSimMember({ db, env: undefined, simId, userId: 'u1' });
    const before = await ledgerOf(db, simId);
    expect(await startSim(event, { simId, title: 'Kept' })).toMatchObject(taken);
    expect(await getRole({ db, simId, userId: 'u1' })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual(before);
  });

  it('a non-writer at the cap posting an id in use gets 409 taken, not the quota', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedUser(db, { id: 'm1', email: 'm1@test.com' });
    await seedManagedSims(db, { managerId: 'u1', count: 1000 });
    const simId = await seedSim(db, { title: 'Theirs', managerId: 'm1' });
    expect(await startSim(event, { simId, title: 'Mine' })).toMatchObject(taken);
  });

  it('answers 403 quota for the 1,001st new sim', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedManagedSims(db, { managerId: 'u1', count: 1000 });
    const simId = newId();
    expect(await startSim(event, { simId, title: 'One more' })).toMatchObject({
      status: 403,
      data: { error: SIMS_COPY.quota, code: 'quota' }
    });
    expect(await getSimTitle({ db, simId })).toBeNull();
  });

  it('answers 429 rate over the creation limit, keyed by identity, and inserts nothing', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const { db, event } = setup({
      user: { id: 'u1', pseudonymous: false },
      env: { ENVIRONMENT: 'production', MUTATION_REGISTERED_RL: { limit } }
    });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const simId = newId();
    expect(await startSim(event, { simId, title: 'Fast' })).toMatchObject({
      status: 429,
      data: { error: SIMS_COPY.tooManySims, code: 'rate' }
    });
    expect(limit).toHaveBeenCalledWith({ key: 'sim_start:u1' });
    expect(await db.select().from(simIndex)).toEqual([]);
  });

  it('keys a freshly minted identity by its new id', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const { db, event } = setup({
      env: { ENVIRONMENT: 'production', MUTATION_REGISTERED_RL: { limit } }
    });
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    mint.mockResolvedValue({ ok: true, user: { id: 'p1', pseudonymous: false } });
    const simId = newId();
    expect(await startSim(event, { simId, title: 'Fresh' })).toEqual({ simId, created: true });
    expect(limit).toHaveBeenCalledWith({ key: 'sim_start:p1' });
  });

  it('fails closed in production when the limiter binding is missing', async () => {
    const { db, event } = setup({
      user: { id: 'u1', pseudonymous: false },
      env: { ENVIRONMENT: 'production' }
    });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const { error } = mockConsole('error');
    expect(await startSim(event, { simId: newId(), title: 'No limiter' })).toMatchObject({
      status: 429,
      data: { code: 'rate' }
    });
    expect(error).toHaveBeenCalledOnce();
    expect(await db.select().from(simIndex)).toEqual([]);
    error.mockRestore();
  });

  it('a create that throws: 500 failed, logged with the sim id only, and a retry creates it', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    // A database error's message carries the bound parameters: an identity among them.
    createFails.with = Object.assign(new Error('Failed query: insert … params: u1, Garden'), {
      name: 'DrizzleQueryError'
    });
    const { error } = mockConsole('error');
    const simId = newId();
    const res = await startSim(event, { simId, title: 'Garden' });
    expect(res).toMatchObject({
      status: 500,
      data: { error: SIMS_COPY.createFailed, code: 'failed' }
    });
    expect(error).toHaveBeenCalledWith('[start-sim] create failed', simId, expect.any(String));
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('u1');
    expect(logged).not.toContain('Garden');
    error.mockRestore();
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([]);
    createFails.with = null;
    expect(await startSim(event, { simId, title: 'Garden' })).toEqual({ simId, created: true });
  });

  it('a create that committed and then threw: the retry answers the no-op', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    createFails.after = new Error('connection reset');
    const { error } = mockConsole('error');
    const simId = newId();
    expect(await startSim(event, { simId, title: 'Garden' })).toMatchObject({
      status: 500,
      data: { code: 'failed' }
    });
    error.mockRestore();
    createFails.after = null;
    expect(await startSim(event, { simId, title: 'Garden' })).toEqual({ simId, created: false });
    expect(await ledgerOf(db, simId)).toEqual([{ principalId: 'u1', action: 'grant' }]);
  });

  it('a reseed that throws after the insert still answers created', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: true } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    reseed.fails = new Error('reseed boom');
    const { error } = mockConsole('error');
    const simId = newId();
    expect(await startSim(event, { simId, title: 'Garden' })).toEqual({ simId, created: true });
    expect(error).toHaveBeenCalledWith('[start-sim] reseed failed', 'reseed boom');
    expect(await getRole({ db, simId, userId: 'u1' })).toBe('manager');
    error.mockRestore();
  });

  it('does not reseed the handle of a signed-in user who already has a sim', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: true } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com', handle: 'keepme' });
    await seedSim(db, { title: 'First', managerId: 'u1' });
    const simId = newId();
    expect(await startSim(event, { simId, title: 'Second' })).toEqual({ simId, created: true });
    expect(mint).not.toHaveBeenCalled();
    expect(reseed.calls).toBe(0);
    const [row] = await db.select().from(userTable).where(eq(userTable.userIdentity, 'u1'));
    expect(row.handle).toBe('keepme');
  });

  it('one caller registering one new id twice at once: one created, one no-op, one grant', async () => {
    const { db, event } = setup({ user: { id: 'u1', pseudonymous: false } });
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const simId = newId();
    const results = await Promise.all([
      startSim(event, { simId, title: 'Twice' }),
      startSim(event, { simId, title: 'Twice' })
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { simId, created: true },
        { simId, created: false }
      ])
    );
    expect(await ledgerOf(db, simId)).toEqual([{ principalId: 'u1', action: 'grant' }]);
  });

  it('two callers registering one new id at once: one manager, the other refused with nothing', async () => {
    const a = setup({ user: { id: 'a', pseudonymous: false } });
    await seedUser(a.db, { id: 'a', email: 'a@test.com' });
    await seedUser(a.db, { id: 'b', email: 'b@test.com' });
    const b = {
      ...a.event,
      locals: { user: { id: 'b', pseudonymous: false } }
    } as unknown as RequestEvent;
    const simId = newId();
    const [ra, rb] = await Promise.all([
      startSim(a.event, { simId, title: 'A' }),
      startSim(b, { simId, title: 'B' })
    ]);
    const won = [ra, rb].filter((r) => 'created' in r && r.created);
    expect(won).toHaveLength(1);
    const loser = won[0] === ra ? rb : ra;
    expect(loser).toMatchObject(taken);
    const winnerId = won[0] === ra ? 'a' : 'b';
    expect(await ledgerOf(a.db, simId)).toEqual([{ principalId: winnerId, action: 'grant' }]);
  });
});
