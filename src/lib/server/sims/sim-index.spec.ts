import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb,
  seedSim,
  seedUser,
  seedIdentity as seedIdentityHelper
} from '$lib/server/test/auth-db';
import { userVersion, simIndex, simCommit, simTakedown } from '$lib/server/db/schema';
import * as schema from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';
import {
  insertSimIndexIfFree,
  simIdInUse,
  listSimsForUser,
  getRole,
  getSimTitle,
  addMember,
  addMemberById,
  listMembers,
  countSimsManagedBy,
  reconcileSimManagement,
  removeMembership,
  prepareLeave
} from './sim-index';
import { addSimRole } from './sim-roles';

describe('seedSim + listSimsForUser', () => {
  it('records an index row and a manager membership, then lists it', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedSim(db, { simId: 'q-uuid', title: 'My Sim', managerId: 'owner1' });
    const rows = await listSimsForUser({ db, userId: 'owner1' });
    expect(rows).toEqual([{ simId: 'q-uuid', title: 'My Sim', role: 'manager' }]);
  });

  it('does not list sims the user is not a member of', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'stranger', email: 's@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: 'owner1' });
    expect(await listSimsForUser({ db, userId: 'stranger' })).toHaveLength(0);
  });
});

/** Each way an id can have a past: a row in one of the tables that name it. */
const PASTS: Array<
  [string, (db: ReturnType<typeof freshDb>['db'], simId: string) => Promise<unknown>]
> = [
  [
    'an index row',
    (db, simId) =>
      db
        .insert(simIndex)
        .values({ simId, title: 'T', createdAt: new Date(), updatedAt: new Date() })
  ],
  [
    'a takedown mark',
    (db, simId) => db.insert(simTakedown).values({ simId, takenDownAt: new Date() })
  ],
  [
    'a stored commit envelope',
    (db, simId) =>
      db.insert(simCommit).values({
        simId,
        seq: 0,
        kind: 'system',
        source: 'sim.start',
        actor: 'someone',
        at: new Date(),
        build: 'b1',
        datasetVersion: 'fixture-0',
        bytes: 10
      })
  ],
  [
    'a ledger event',
    async (db, simId) => {
      await seedUser(db, { id: 'old', email: 'old@test.com' });
      await addSimRole(db, simId, 'old', 'viewer', null);
    }
  ]
];

describe('insertSimIndexIfFree', () => {
  it('inserts a free id once: true, then false', async () => {
    const { db } = freshDb();
    const simId = newId();
    expect(await insertSimIndexIfFree({ db, simId, title: 'Garden' })).toBe(true);
    expect(await insertSimIndexIfFree({ db, simId, title: 'Other' })).toBe(false);
    expect(await getSimTitle({ db, simId })).toBe('Garden');
  });

  it.each(PASTS)('inserts nothing for an id with %s', async (_name, seed) => {
    const { db } = freshDb();
    const simId = newId();
    await seed(db, simId);
    const before = await db.select().from(simIndex).where(eq(simIndex.simId, simId));
    expect(await insertSimIndexIfFree({ db, simId, title: 'Mine now' })).toBe(false);
    expect(await db.select().from(simIndex).where(eq(simIndex.simId, simId))).toEqual(before);
  });

  it('stores the title in NFC', async () => {
    const { db } = freshDb();
    const simId = newId();
    await insertSimIndexIfFree({ db, simId, title: 'Café' });
    expect(await getSimTitle({ db, simId })).toBe('Café');
  });
});

describe('simIdInUse', () => {
  it('is false for a fresh id', async () => {
    const { db } = freshDb();
    expect(await simIdInUse(db, newId())).toBe(false);
  });

  it.each(PASTS)('is true for an id with %s', async (_name, seed) => {
    const { db } = freshDb();
    const simId = newId();
    await seed(db, simId);
    expect(await simIdInUse(db, simId)).toBe(true);
  });
});

describe('countSimsManagedBy', () => {
  it('counts only manager memberships, per manager, including co-owned sims', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'creator', email: 'c@test.com' });
    await seedUser(db, { id: 'cohort', email: 'co@test.com' });
    // creator solely owns q1
    await seedSim(db, { simId: 'q1', title: 'Q1', managerId: 'creator' });
    // q2 created by creator; cohort added as a co-manager
    await seedSim(db, { simId: 'q2', title: 'Q2', managerId: 'creator' });
    await addMember({ db, simId: 'q2', email: 'co@test.com', role: 'manager' });
    // q3 created by creator; cohort added only as an editor
    await seedSim(db, { simId: 'q3', title: 'Q3', managerId: 'creator' });
    await addMember({ db, simId: 'q3', email: 'co@test.com', role: 'editor' });

    expect(await countSimsManagedBy({ db, userId: 'creator' })).toBe(3);
    expect(await countSimsManagedBy({ db, userId: 'cohort' })).toBe(1); // only co-managed q2
    expect(await countSimsManagedBy({ db, userId: 'nobody' })).toBe(0);
  });
});

describe('getRole', () => {
  it('returns the role for a member and null for a non-member', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: 'owner1' });
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBe('manager');
    expect(await getRole({ db, simId: 'q1', userId: 'nobody' })).toBeNull();
  });
});

describe('getRole folds the survivor+fused union from the capability ledger', () => {
  // Insert a userIdentity row (+ its principal) so we can set supersededById (seedUser can't).
  async function seedIdentity(
    db: ReturnType<typeof freshDb>['db'],
    id: string,
    supersededById: string | null = null
  ) {
    await seedIdentityHelper(db, { id, supersededById: supersededById ?? undefined });
  }

  async function seedIndex(db: ReturnType<typeof freshDb>['db'], simId: string) {
    await db.insert(simIndex).values({
      simId,
      title: 'T',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  it('unions to the HIGHER role when the survivor also holds its own', async () => {
    const { db } = freshDb();
    await seedIdentity(db, 'B');
    await seedIdentity(db, 'A', 'B');
    await seedIndex(db, 'q1');
    await addSimRole(db, 'q1', 'A', 'manager', null);
    await addSimRole(db, 'q1', 'B', 'viewer', null);

    expect(await getRole({ db, simId: 'q1', userId: 'B' })).toBe('manager');
  });

  it('inherits an ancestor role under a depth-1 star (A→S, B→S)', async () => {
    const { db } = freshDb();
    await seedIdentity(db, 'S'); // live survivor
    await seedIdentity(db, 'B', 'S'); // B fused into S
    await seedIdentity(db, 'A', 'S'); // A fused into S (compressed — points at S, not B)
    await seedIndex(db, 'q1');
    await addSimRole(db, 'q1', 'A', 'manager', null);

    expect(await getRole({ db, simId: 'q1', userId: 'S' })).toBe('manager');
  });

  it('returns null when neither the user nor any fused identity is a member', async () => {
    const { db } = freshDb();
    await seedIdentity(db, 'B');
    await seedIdentity(db, 'A', 'B');
    // A is fused into B but has no membership in q1.
    await seedIdentity(db, 'someoneElse');
    await seedIndex(db, 'q1');
    await addSimRole(db, 'q1', 'someoneElse', 'manager', null);

    expect(await getRole({ db, simId: 'q1', userId: 'B' })).toBeNull();
  });
});

describe('control-plane membership ops', () => {
  async function setup() {
    const { db } = freshDb();
    const manager = await seedUser(db, { id: 'manager', email: 'manager@test.com' });
    const ed = await seedUser(db, { id: 'ed', email: 'ed@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
    return { db, manager, ed };
  }

  it('addMember inserts a membership for a known user', async () => {
    const { db, ed } = await setup();
    const res = await addMember({ db, simId: 'q1', email: ed.email, role: 'editor' });
    expect(res).toEqual({ userId: 'ed' });
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBe('editor');
  });

  it('addMember rejects an unknown email', async () => {
    const { db } = await setup();
    await expect(
      addMember({ db, simId: 'q1', email: 'nobody@test.com', role: 'editor' })
    ).rejects.toThrow('user not found');
  });

  it('addMember rejects an existing member', async () => {
    const { db, ed } = await setup();
    await addMember({ db, simId: 'q1', email: ed.email, role: 'editor' });
    await expect(addMember({ db, simId: 'q1', email: ed.email, role: 'viewer' })).rejects.toThrow(
      'already a member'
    );
  });

  it('listMembers joins emails and sorts manager→editor then by name', async () => {
    const { db, ed } = await setup();
    await addMember({ db, simId: 'q1', email: ed.email, role: 'editor' });
    const members = await listMembers({ db, simId: 'q1' });
    expect(members).toEqual([
      {
        userId: 'manager',
        email: 'manager@test.com',
        name: 'manager@test.com',
        handle: 'manager',
        image: null,
        role: 'manager'
      },
      {
        userId: 'ed',
        email: 'ed@test.com',
        name: 'ed@test.com',
        handle: 'ed',
        image: null,
        role: 'editor'
      }
    ]);
  });

  it('addMemberById adds a membership by identity id and returns { added: true }', async () => {
    const { db, ed } = await setup();
    const res = await addMemberById({ db, simId: 'q1', userId: ed.id, role: 'editor' });
    expect(res).toEqual({ added: true });
    expect(await getRole({ db, simId: 'q1', userId: ed.id })).toBe('editor');
  });
});

describe('listMembers image field', () => {
  it('includes image from the live user row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'manager', email: 'manager@test.com' });
    // Set image directly on the live user row.
    await db
      .update(schema.user)
      .set({ image: 'https://img/x.png' })
      .where(eq(schema.user.userIdentity, 'manager'));
    await seedSim(db, { simId: 'q1', title: 'T', managerId: 'manager' });
    const members = await listMembers({ db, simId: 'q1' });
    expect(members[0]).toMatchObject({ handle: expect.any(String), image: 'https://img/x.png' });
  });
});

describe('listMembers reads display fields from the ACTIVE user_version', () => {
  it('returns email/name/handle of the active version, ignoring superseded rows', async () => {
    const { db } = freshDb();
    // seedUser creates the stable identity + active version (id `manager-v1`, version 1).
    await seedUser(db, {
      id: 'manager',
      email: 'new@test.com',
      name: 'New Name',
      handle: 'newbie'
    });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: 'manager' });

    // Insert a history trail row for the same identity with different display fields.
    // listMembers reads from the live `user` row, so this history entry must be ignored.
    const past = new Date('2020-01-01T00:00:00Z');
    await db.insert(userVersion).values({
      id: 'manager-v0',
      name: 'Old Name',
      email: 'old@test.com',
      userIdentity: 'manager',
      handle: 'oldie',
      capturedAt: past
    });

    const members = await listMembers({ db, simId: 'q1' });
    expect(members).toEqual([
      {
        userId: 'manager',
        email: 'new@test.com',
        name: 'New Name',
        handle: 'newbie',
        image: null,
        role: 'manager'
      }
    ]);
  });
});

describe('reconcileSimManagement', () => {
  it('is a no-op when a manager is present', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedSim(db, { simId: 'q1', title: 'Q', managerId: 'owner1' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    await addMemberById({ db, simId: 'q1', userId: 'ed', role: 'editor' });
    expect(await reconcileSimManagement(db, 'q1')).toEqual({ empty: false });
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBe('manager');
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBe('editor');
  });

  it('promotes an auto-picked successor (editor over viewer) when managerless', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'v', email: 'v@test.com' });
    await seedUser(db, { id: 'e', email: 'e@test.com' });
    await db
      .insert(simIndex)
      .values({ simId: 'q1', title: 'Q', createdAt: new Date(), updatedAt: new Date() });
    await addSimRole(db, 'q1', 'v', 'viewer', null);
    await addSimRole(db, 'q1', 'e', 'editor', null);
    expect(await reconcileSimManagement(db, 'q1')).toEqual({ empty: false });
    expect(await getRole({ db, simId: 'q1', userId: 'e' })).toBe('manager');
    expect(await getRole({ db, simId: 'q1', userId: 'v' })).toBe('viewer');
  });

  it('reports empty when there are no members', async () => {
    const { db } = freshDb();
    expect(await reconcileSimManagement(db, 'q1')).toEqual({ empty: true });
  });
});

describe('removeMembership', () => {
  async function seedSoleManagerPlus(
    db: ReturnType<typeof freshDb>['db'],
    extras: { id: string; role: 'manager' | 'editor' | 'viewer' }[]
  ) {
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedSim(db, { simId: 'q1', title: 'My Sim', managerId: 'owner1' });
    for (const m of extras) {
      await seedUser(db, { id: m.id, email: `${m.id}@test.com` });
      await addMemberById({ db, simId: 'q1', userId: m.id, role: m.role });
    }
  }

  it('removes a non-manager and leaves the manager (not empty)', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'ed', role: 'editor' }]);
    const res = await removeMembership(db, 'q1', 'ed');
    expect(res.empty).toBe(false);
    // `members` is the PRE-revocation roster — the departing member is still on it
    // (nothing reads it today; it is returned for callers that need the departing roster).
    expect(res.members.map((m) => m.userId).sort()).toEqual(['ed', 'owner1']);
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBeNull();
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBe('manager');
  });

  it('removing the sole manager with members promotes a successor', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'ed', role: 'editor' }]);
    const res = await removeMembership(db, 'q1', 'owner1');
    expect(res.empty).toBe(false);
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBeNull();
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBe('manager');
  });

  it('removing the sole member reports empty, with the pre-revocation roster', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, []);
    const res = await removeMembership(db, 'q1', 'owner1');
    expect(res.empty).toBe(true);
    expect(res.members.map((m) => m.userId)).toEqual(['owner1']);
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBeNull();
  });

  // Co-manager protection (opt-in via actorUserId).
  it('refuses a manager administratively removing ANOTHER manager', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'owner2', role: 'manager' }]);
    await expect(removeMembership(db, 'q1', 'owner2', { actorUserId: 'owner1' })).rejects.toThrow(
      /another manager/
    );
    // Untouched: owner2 still a manager.
    expect(await getRole({ db, simId: 'q1', userId: 'owner2' })).toBe('manager');
  });

  it('allows a manager administratively removing a non-manager', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'ed', role: 'editor' }]);
    expect(await removeMembership(db, 'q1', 'ed', { actorUserId: 'owner1' })).toMatchObject({
      empty: false
    });
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBeNull();
  });

  it('allows removing yourself even as a manager (actorUserId === target)', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'owner2', role: 'manager' }]);
    expect(await removeMembership(db, 'q1', 'owner1', { actorUserId: 'owner1' })).toMatchObject({
      empty: false
    });
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBeNull();
  });

  it('without actorUserId the guard is inert (account-deletion / orphan path may remove a manager)', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'owner2', role: 'manager' }]);
    expect(await removeMembership(db, 'q1', 'owner2')).toMatchObject({ empty: false });
    expect(await getRole({ db, simId: 'q1', userId: 'owner2' })).toBeNull();
  });
});

describe('prepareLeave', () => {
  async function seedSoleManagerPlus(
    db: ReturnType<typeof freshDb>['db'],
    extras: { id: string; role: 'manager' | 'editor' | 'viewer' }[]
  ) {
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedSim(db, { simId: 'q1', title: 'My Sim', managerId: 'owner1' });
    for (const m of extras) {
      await seedUser(db, { id: m.id, email: `${m.id}@test.com` });
      await addMemberById({ db, simId: 'q1', userId: m.id, role: m.role });
    }
  }

  it('throws when the caller is not a member', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, []);
    await expect(
      prepareLeave(db, { simId: 'q1', userId: 'ghost', simTitle: 'My Sim' })
    ).rejects.toThrow('not a member');
  });

  it('throws title-mismatch for a co-manager with the wrong title, no-ops with the right one', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'owner2', role: 'manager' }]);
    await expect(
      prepareLeave(db, {
        simId: 'q1',
        userId: 'owner2',
        simTitle: 'My Sim',
        confirmTitle: 'x'
      })
    ).rejects.toThrow('title did not match');
    await prepareLeave(db, {
      simId: 'q1',
      userId: 'owner2',
      simTitle: 'My Sim',
      confirmTitle: 'My Sim'
    });
    expect(await getRole({ db, simId: 'q1', userId: 'owner2' })).toBe('manager');
  });

  it('promotes a valid chosen successor for the sole manager', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'ed', role: 'editor' }]);
    await prepareLeave(db, {
      simId: 'q1',
      userId: 'owner1',
      simTitle: 'My Sim',
      successorUserId: 'ed'
    });
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBe('manager');
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBe('manager');
  });

  it('no-ops when the sole manager names a non-member successor', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'ed', role: 'editor' }]);
    await prepareLeave(db, {
      simId: 'q1',
      userId: 'owner1',
      simTitle: 'My Sim',
      successorUserId: 'ghost'
    });
    expect(await getRole({ db, simId: 'q1', userId: 'ed' })).toBe('editor');
    expect(await getRole({ db, simId: 'q1', userId: 'owner1' })).toBe('manager');
  });

  it('no-ops for a non-manager leaver', async () => {
    const { db } = freshDb();
    await seedSoleManagerPlus(db, [{ id: 'v', role: 'viewer' }]);
    await prepareLeave(db, { simId: 'q1', userId: 'v', simTitle: 'My Sim' });
    expect(await getRole({ db, simId: 'q1', userId: 'v' })).toBe('viewer');
  });
});

describe('getSimTitle', () => {
  it('returns the index-projected title', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedSim(db, { simId: 'q1', title: 'My Sim', managerId: 'owner1' });
    expect(await getSimTitle({ db, simId: 'q1' })).toBe('My Sim');
  });

  it('returns null for a sim with no index row (e.g. a demo copy)', async () => {
    const { db } = freshDb();
    expect(await getSimTitle({ db, simId: 'no-such-sim' })).toBeNull();
  });
});
