import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { capabilityEvent, simInvite } from '$lib/server/db/schema';
import { isValidId } from '$lib/server/ids/factory';
import { addMemberById, getRole, getSimTitle } from './sim-index';
import { foldSimRole } from './sim-roles';
import { onSimRosterChanged } from './roster-hook';
import { createSim, leaveSim, removeSimMember } from './sims';

vi.mock('./roster-hook', () => ({ onSimRosterChanged: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.mocked(onSimRosterChanged).mockClear();
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

describe('createSim', () => {
  it('createSim inserts the index row, then a manager grant by the manager', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const { simId } = await createSim({ db, title: 'My Sim', managerId: 'owner1' });
    expect(isValidId(simId)).toBe(true);
    expect(await getSimTitle({ db, simId })).toBe('My Sim');
    expect(await getRole({ db, simId, userId: 'owner1' })).toBe('manager');
    expect(await foldSimRole(db, simId, 'owner1')).toBe('manager');
    const rows = await db
      .select({ actorId: capabilityEvent.actorId })
      .from(capabilityEvent)
      .where(eq(capabilityEvent.resourceId, simId));
    expect(rows.map((r) => r.actorId)).toEqual(['owner1']);
  });
});

describe('removeSimMember', () => {
  it('removeSimMember deletes an emptied sim and its pending invites', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const { simId } = await createSim({ db, title: 'Q', managerId: 'owner1' });
    await seedInvite(db, simId, 'owner1', 'pending', 'h1');
    await seedInvite(db, simId, 'owner1', 'accepted', 'h2');

    const result = await removeSimMember({ db, simId, userId: 'owner1' });

    expect(result).toEqual({ deleted: true });
    expect(await getSimTitle({ db, simId })).toBeNull();
    const rows = await db.select().from(simInvite).where(eq(simInvite.simId, simId));
    expect(rows.filter((r) => r.status === 'pending')).toEqual([]);
    expect(rows.map((r) => r.status)).toEqual(['accepted']);
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });

  it('removeSimMember promotes a successor when the last manager goes', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const { simId } = await createSim({ db, title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });

    const result = await removeSimMember({ db, simId, userId: 'owner1' });

    expect(result).toEqual({ deleted: false });
    expect(await getRole({ db, simId, userId: 'owner1' })).toBeNull();
    expect(await getRole({ db, simId, userId: 'ed' })).toBe('manager');
  });

  it('removeSimMember refuses to remove another manager', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'co', email: 'c@test.com' });
    const { simId } = await createSim({ db, title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'co', role: 'manager' });

    await expect(
      removeSimMember({ db, simId, userId: 'co', actorUserId: 'owner1' })
    ).rejects.toThrow('cannot remove another manager; they must leave the sim themselves');
    expect(await getRole({ db, simId, userId: 'co' })).toBe('manager');
  });

  it('calls onSimRosterChanged after a removal that keeps the sim', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const { simId } = await createSim({ db, title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });

    await removeSimMember({ db, simId, userId: 'ed' });

    expect(onSimRosterChanged).toHaveBeenCalledTimes(1);
    expect(onSimRosterChanged).toHaveBeenCalledWith(simId);
  });
});

describe('leaveSim', () => {
  it('leaveSim honours the chosen successor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    await seedUser(db, { id: 'ed2', email: 'e2@test.com' });
    const { simId } = await createSim({ db, title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    await addMemberById({ db, simId, userId: 'ed2', role: 'editor' });

    await leaveSim({ db, simId, userId: 'owner1', simTitle: 'Q', successorUserId: 'ed2' });

    expect(await getRole({ db, simId, userId: 'owner1' })).toBeNull();
    expect(await getRole({ db, simId, userId: 'ed2' })).toBe('manager');
    expect(await getRole({ db, simId, userId: 'ed' })).toBe('editor');
  });

  it('leaveSim by a co-manager requires the typed title', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'co', email: 'c@test.com' });
    const { simId } = await createSim({ db, title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'co', role: 'manager' });

    await expect(
      leaveSim({ db, simId, userId: 'co', simTitle: 'Q', confirmTitle: 'nope' })
    ).rejects.toThrow('title did not match');
    expect(await getRole({ db, simId, userId: 'co' })).toBe('manager');

    await leaveSim({ db, simId, userId: 'co', simTitle: 'Q', confirmTitle: 'Q' });
    expect(await getRole({ db, simId, userId: 'co' })).toBeNull();
  });
});
