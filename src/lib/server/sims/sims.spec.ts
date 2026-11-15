import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedSim, seedUser } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { capabilityEvent, simCommit, simInvite, simTakedown } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';
import { addMemberById, getRole, getSimTitle, listMembers } from './sim-index';
import { foldSimRole, setSimRole } from './sim-roles';
import { handleAccountLink } from '$lib/server/user-store/identity';
import { onSimRosterChanged } from './roster-hook';
import { createSim, deleteSim, leaveSim, removeSimMember, SimGrantFailed } from './sims';

vi.mock('./roster-hook', () => ({ onSimRosterChanged: vi.fn(async () => {}) }));
// addSimRole stays real unless a case makes the manager grant throw.
const grant = vi.hoisted(() => ({ fails: null as Error | null }));
vi.mock('./sim-roles', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sim-roles')>();
  return {
    ...real,
    addSimRole: (...a: Parameters<typeof real.addSimRole>) => {
      if (grant.fails) throw grant.fails;
      return real.addSimRole(...a);
    }
  };
});

/** Stands in for platform.env: the hook must receive it as given. */
const env = { marker: 'env' };

beforeEach(() => {
  vi.mocked(onSimRosterChanged).mockClear();
  grant.fails = null;
});

async function seedInvite(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  simId: string,
  invitedBy: string,
  status: 'pending' | 'accepted',
  hash: string
) {
  await db.insert(simInvite).values({
    id: `inv-${hash}`,
    simId,
    role: 'editor',
    invitedEmail: `${hash}@test.com`,
    tokenHash: hash,
    invitedByUserId: invitedBy,
    status,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1000)
  });
}

/** Every ledger event naming the sim, as (principal, action). */
async function ledgerOf(db: Awaited<ReturnType<typeof freshDb>>['db'], simId: string) {
  return db
    .select({ principalId: capabilityEvent.principalId, action: capabilityEvent.action })
    .from(capabilityEvent)
    .where(eq(capabilityEvent.resourceId, simId));
}

describe('createSim', () => {
  it('createSim inserts the index row, then a manager grant by the manager', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = newId();
    expect(await createSim({ db, env, simId, title: 'My Sim', managerId: 'owner1' })).toEqual({
      simId,
      created: true
    });
    expect(await getSimTitle({ db, simId })).toBe('My Sim');
    expect(await getRole({ db, simId, userId: 'owner1' })).toBe('manager');
    expect(await foldSimRole(db, simId, 'owner1')).toBe('manager');
    const rows = await db
      .select({ actorId: capabilityEvent.actorId })
      .from(capabilityEvent)
      .where(eq(capabilityEvent.resourceId, simId));
    expect(rows.map((r) => r.actorId)).toEqual(['owner1']);
  });

  // A sim just registered cannot have an open socket (the stream route answers 404 until its
  // index row exists), so there is no object to tell.
  it('createSim does not call onSimRosterChanged', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await createSim({ db, env, simId: newId(), title: 'My Sim', managerId: 'owner1' });
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });

  it('registers a browser-minted id once: the second call changes nothing', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'other', email: 'o@test.com' });
    const simId = newId();
    expect(await createSim({ db, env, simId, title: 'Mine', managerId: 'owner1' })).toEqual({
      simId,
      created: true
    });
    expect(await createSim({ db, env, simId, title: 'Theirs', managerId: 'other' })).toEqual({
      simId,
      created: false
    });
    expect(await getSimTitle({ db, simId })).toBe('Mine');
    expect(await getRole({ db, simId, userId: 'other' })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([{ principalId: 'owner1', action: 'grant' }]);
  });

  it('never registers a taken-down id', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = newId();
    await db.insert(simTakedown).values({ simId, takenDownAt: new Date() });
    expect(await createSim({ db, env, simId, title: 'Again', managerId: 'owner1' })).toEqual({
      simId,
      created: false
    });
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([]);
  });

  it('never registers an id with a stored commit envelope and no index row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = newId();
    await db.insert(simCommit).values({
      simId,
      seq: 0,
      kind: 'system',
      source: 'sim.start',
      actor: 'someone',
      at: new Date(),
      build: 'b1',
      datasetVersion: 'fixture-0',
      bytes: 10
    });
    expect(await createSim({ db, env, simId, title: 'Old log', managerId: 'owner1' })).toEqual({
      simId,
      created: false
    });
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([]);
  });

  it('never registers an id with a ledger event and no index row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'old', email: 'old@test.com' });
    const simId = newId();
    // The old code deleted index rows and left the ledger: a grant with no index row.
    await setSimRole(db, simId, 'old', 'manager', null);
    expect(await createSim({ db, env, simId, title: 'Old ledger', managerId: 'owner1' })).toEqual({
      simId,
      created: false
    });
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([{ principalId: 'old', action: 'grant' }]);
  });

  it('never registers a sim kept with no members, not even for its former manager', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = newId();
    await createSim({ db, env, simId, title: 'Kept', managerId: 'owner1' });
    await removeSimMember({ db, env, simId, userId: 'owner1' });
    const before = await ledgerOf(db, simId);
    expect(await createSim({ db, env, simId, title: 'Again', managerId: 'owner1' })).toEqual({
      simId,
      created: false
    });
    expect(await getRole({ db, simId, userId: 'owner1' })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual(before);
  });

  it('refuses an id that is not a valid id', async () => {
    const { db } = freshDb();
    await expect(
      createSim({ db, env, simId: 'nope', title: 'X', managerId: 'owner1' })
    ).rejects.toThrow('invalid sim id');
  });

  it('stores the title in NFC, as the column does', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = newId();
    await createSim({ db, env, simId, title: 'Café', managerId: 'owner1' });
    expect(await getSimTitle({ db, simId })).toBe('Café');
  });

  it('two callers registering one new id at once: exactly one manager, the other nothing', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'a', email: 'a@test.com' });
    await seedUser(db, { id: 'b', email: 'b@test.com' });
    const simId = newId();
    const results = await Promise.all([
      createSim({ db, env, simId, title: 'A', managerId: 'a' }),
      createSim({ db, env, simId, title: 'B', managerId: 'b' })
    ]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    const winner = results[0].created ? 'a' : 'b';
    const loser = winner === 'a' ? 'b' : 'a';
    expect(await getRole({ db, simId, userId: winner })).toBe('manager');
    expect(await getRole({ db, simId, userId: loser })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([{ principalId: winner, action: 'grant' }]);
  });

  it('a registration racing a takedown mark either lands first or grants nothing', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    for (const markFirst of [true, false]) {
      const simId = newId();
      const mark = () => db.insert(simTakedown).values({ simId, takenDownAt: new Date() });
      const register = () => createSim({ db, env, simId, title: 'Race', managerId: 'owner1' });
      const [a, b] = markFirst ? [mark, register] : [register, mark];
      const [ra, rb] = await Promise.all([a(), b()]);
      const { created } = (markFirst ? rb : ra) as { created: boolean };
      // Both orders are possible on D1; whichever happened, a refusal granted nothing.
      if (created) {
        expect(await ledgerOf(db, simId)).toEqual([{ principalId: 'owner1', action: 'grant' }]);
      } else {
        expect(await ledgerOf(db, simId)).toEqual([]);
        expect(await getSimTitle({ db, simId })).toBeNull();
      }
    }
  });

  it('a grant that fails after the insert removes the row it inserted, logs, and throws', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = newId();
    // A database error's message carries the bound parameters: an identity among them.
    grant.fails = Object.assign(new Error('Failed query: insert … params: owner1'), {
      name: 'DrizzleQueryError'
    });
    const { error } = mockConsole('error');
    await expect(
      createSim({ db, env, simId, title: 'Stranded', managerId: 'owner1' })
    ).rejects.toBeInstanceOf(SimGrantFailed);
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await ledgerOf(db, simId)).toEqual([]);
    expect(error).toHaveBeenCalledWith('[start-sim] grant failed', simId, expect.any(String));
    expect(JSON.stringify(error.mock.calls)).not.toContain('owner1');
    expect(JSON.stringify(error.mock.calls)).not.toContain('Stranded');
    error.mockRestore();
    // The id is free again: nobody's past is on it.
    grant.fails = null;
    expect(await createSim({ db, env, simId, title: 'Again', managerId: 'owner1' })).toEqual({
      simId,
      created: true
    });
  });
});

describe('deleteSim', () => {
  it('drops the index row and the pending invites in one batch', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await seedInvite(db, simId, 'owner1', 'pending', 'h1');
    const batch = vi.spyOn(db, 'batch');

    await deleteSim(db, simId);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await db.select().from(simInvite).where(eq(simInvite.simId, simId))).toEqual([]);
  });
});

describe('removeSimMember', () => {
  it('removeSimMember keeps an emptied sim, ends its pending invitations and tells the object', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await seedInvite(db, simId, 'owner1', 'pending', 'h1');
    await seedInvite(db, simId, 'owner1', 'accepted', 'h2');
    vi.mocked(onSimRosterChanged).mockClear();

    const result = await removeSimMember({ db, env, simId, userId: 'owner1' });

    expect(result).toEqual({ empty: true });
    expect(await getSimTitle({ db, simId })).toBe('Q');
    const rows = await db.select().from(simInvite).where(eq(simInvite.simId, simId));
    expect(rows.map((r) => r.status)).toEqual(['accepted']);
    expect(await listMembers({ db, simId })).toEqual([]);
    // The last member's open socket must lose write too.
    expect(onSimRosterChanged).toHaveBeenCalledOnce();
    expect(onSimRosterChanged).toHaveBeenCalledWith(env, simId);
  });

  it('a failure ending the pending invitations still tells the object and does not fail the removal', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await seedInvite(db, simId, 'owner1', 'pending', 'h1');
    vi.mocked(onSimRosterChanged).mockClear();
    const { error } = mockConsole('error');
    // The revoke never deletes (the ledger is append-only); only the invitations' end does.
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'delete')
          return () => {
            throw new Error('delete boom');
          };
        return Reflect.get(target, prop, receiver);
      }
    }) as typeof db;

    await expect(removeSimMember({ db: failing, env, simId, userId: 'owner1' })).resolves.toEqual({
      empty: true
    });

    expect(await getRole({ db, simId, userId: 'owner1' })).toBeNull();
    expect(onSimRosterChanged).toHaveBeenCalledWith(env, simId);
    expect(error).toHaveBeenCalledWith(
      '[remove-member] pending invites not ended',
      simId,
      'delete boom'
    );
    error.mockRestore();
  });

  it('removeSimMember promotes a successor when the last manager goes', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });

    const result = await removeSimMember({ db, env, simId, userId: 'owner1' });

    expect(result).toEqual({ empty: false });
    expect(await getRole({ db, simId, userId: 'owner1' })).toBeNull();
    expect(await getRole({ db, simId, userId: 'ed' })).toBe('manager');
  });

  it('removeSimMember refuses to remove another manager', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'co', email: 'c@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'co', role: 'manager' });

    await expect(
      removeSimMember({ db, env, simId, userId: 'co', actorUserId: 'owner1' })
    ).rejects.toThrow('cannot remove another manager; they must leave the sim themselves');
    expect(await getRole({ db, simId, userId: 'co' })).toBe('manager');
  });

  it('calls onSimRosterChanged after a removal that keeps the sim', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    vi.mocked(onSimRosterChanged).mockClear();

    await removeSimMember({ db, env, simId, userId: 'ed' });

    expect(onSimRosterChanged).toHaveBeenCalledTimes(1);
    expect(onSimRosterChanged).toHaveBeenCalledWith(env, simId);
  });

  it('with notify: false, removes without calling onSimRosterChanged', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });

    await removeSimMember({ db, env, simId, userId: 'ed', notify: false });

    expect(await getRole({ db, simId, userId: 'ed' })).toBeNull();
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });
});

describe('leaveSim', () => {
  it('leaveSim honours the chosen successor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    await seedUser(db, { id: 'ed2', email: 'e2@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    await addMemberById({ db, simId, userId: 'ed2', role: 'editor' });

    await leaveSim({ db, env, simId, userId: 'owner1', simTitle: 'Q', successorUserId: 'ed2' });

    expect(await getRole({ db, simId, userId: 'owner1' })).toBeNull();
    expect(await getRole({ db, simId, userId: 'ed2' })).toBe('manager');
    expect(await getRole({ db, simId, userId: 'ed' })).toBe('editor');
  });

  it('leaveSim by a co-manager requires the typed title', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'co', email: 'c@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'co', role: 'manager' });

    await expect(
      leaveSim({ db, env, simId, userId: 'co', simTitle: 'Q', confirmTitle: 'nope' })
    ).rejects.toThrow('title did not match');
    expect(await getRole({ db, simId, userId: 'co' })).toBe('manager');

    await leaveSim({ db, env, simId, userId: 'co', simTitle: 'Q', confirmTitle: 'Q' });
    expect(await getRole({ db, simId, userId: 'co' })).toBeNull();
  });

  it('calls onSimRosterChanged when the sim survives the leave', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    vi.mocked(onSimRosterChanged).mockClear();

    await leaveSim({ db, env, simId, userId: 'ed', simTitle: 'Q' });

    expect(onSimRosterChanged).toHaveBeenCalledTimes(1);
    expect(onSimRosterChanged).toHaveBeenCalledWith(env, simId);
  });
});

// A pseudonymous account (`pseudo`) that signs in by magic link to the email of an existing
// account (`surv`) is fused into it: its grants stay on `pseudo`, and the folds read them
// through `surv`. Removal must reach them too.
describe('a member whose grants sit on a fused identity', () => {
  async function fuse(db: Awaited<ReturnType<typeof freshDb>>['db']) {
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'pseudo-live',
      newUserId: 'surv-live'
    });
  }

  it('leaves a solo sim, which is kept with no members', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'pseudo', email: 'p@test.com' });
    await seedUser(db, { id: 'surv', email: 's@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'pseudo' });
    await fuse(db);
    expect(await getRole({ db, simId, userId: 'surv' })).toBe('manager');

    await leaveSim({ db, env, simId, userId: 'surv', simTitle: 'Q' });

    expect(await getRole({ db, simId, userId: 'surv' })).toBeNull();
    expect(await getSimTitle({ db, simId })).toBe('Q');
  });

  it('leaves a shared sim as its manager, and the other member is promoted', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'pseudo', email: 'p@test.com' });
    await seedUser(db, { id: 'surv', email: 's@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'pseudo' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    await fuse(db);
    vi.mocked(onSimRosterChanged).mockClear();

    await leaveSim({ db, env, simId, userId: 'surv', simTitle: 'Q' });

    expect(await getRole({ db, simId, userId: 'surv' })).toBeNull();
    expect(await getRole({ db, simId, userId: 'ed' })).toBe('manager');
    expect(await getSimTitle({ db, simId })).toBe('Q');
    expect(onSimRosterChanged).toHaveBeenCalledWith(env, simId);
  });

  it('is removed by a manager', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'pseudo', email: 'p@test.com' });
    await seedUser(db, { id: 'surv', email: 's@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'pseudo', role: 'editor' });
    await fuse(db);
    expect(await getRole({ db, simId, userId: 'surv' })).toBe('editor');

    const result = await removeSimMember({ db, env, simId, userId: 'surv', actorUserId: 'owner1' });

    expect(result).toEqual({ empty: false });
    expect(await getRole({ db, simId, userId: 'surv' })).toBeNull();
    expect(await getRole({ db, simId, userId: 'owner1' })).toBe('manager');
  });

  describe('removal by a fused identity id', () => {
    // owner1 and surv manage the sim; ed edits. pseudo is fused into surv, edi into ed.
    async function seedFusedRoster() {
      const { db } = freshDb();
      for (const id of ['owner1', 'surv', 'pseudo', 'ed', 'edi']) {
        await seedUser(db, { id, email: `${id}@test.com` });
      }
      const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
      await addMemberById({ db, simId, userId: 'surv', role: 'manager' });
      await addMemberById({ db, simId, userId: 'pseudo', role: 'editor' });
      await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
      await addMemberById({ db, simId, userId: 'edi', role: 'viewer' });
      await handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'pseudo-live',
        newUserId: 'surv-live'
      });
      await handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'edi-live',
        newUserId: 'ed-live'
      });
      return { db, simId };
    }

    it('refuses a manager passing a co-manager’s fused id, as for the survivor id', async () => {
      const { db, simId } = await seedFusedRoster();
      await expect(
        removeSimMember({ db, env, simId, userId: 'surv', actorUserId: 'owner1' })
      ).rejects.toThrow('cannot remove another manager');
      await expect(
        removeSimMember({ db, env, simId, userId: 'pseudo', actorUserId: 'owner1' })
      ).rejects.toThrow('cannot remove another manager');
      expect(await getRole({ db, simId, userId: 'surv' })).toBe('manager');
    });

    it('removes an editor named by a fused id', async () => {
      const { db, simId } = await seedFusedRoster();
      const result = await removeSimMember({
        db,
        env,
        simId,
        userId: 'edi',
        actorUserId: 'owner1'
      });
      expect(result).toEqual({ empty: false });
      expect(await getRole({ db, simId, userId: 'ed' })).toBeNull();
      expect(await getRole({ db, simId, userId: 'surv' })).toBe('manager');
      expect(await getRole({ db, simId, userId: 'owner1' })).toBe('manager');
    });

    it('treats a member passing their own fused id as self-removal', async () => {
      const { db, simId } = await seedFusedRoster();
      const result = await removeSimMember({
        db,
        env,
        simId,
        userId: 'pseudo',
        actorUserId: 'surv'
      });
      expect(result).toEqual({ empty: false });
      expect(await getRole({ db, simId, userId: 'surv' })).toBeNull();
      expect(await getRole({ db, simId, userId: 'owner1' })).toBe('manager');
    });
  });

  it('is promoted as successor and can then be demoted', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'pseudo', email: 'p@test.com' });
    await seedUser(db, { id: 'surv', email: 's@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'pseudo', role: 'editor' });
    await fuse(db);

    await leaveSim({ db, env, simId, userId: 'owner1', simTitle: 'Q', successorUserId: 'surv' });
    expect(await getRole({ db, simId, userId: 'surv' })).toBe('manager');

    await setSimRole(db, simId, 'surv', 'viewer');
    expect(await getRole({ db, simId, userId: 'surv' })).toBe('viewer');
  });
});
