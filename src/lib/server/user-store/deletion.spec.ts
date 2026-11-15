import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/sims/roster-hook', () => ({
  onSimRosterChanged: vi.fn(async () => {}),
  rosterChangedAll: vi.fn(async () => {})
}));
import { eq } from 'drizzle-orm';
import { onSimRosterChanged, rosterChangedAll } from '$lib/server/sims/roster-hook';
import { freshDb, seedSim, seedUser } from '$lib/server/test/auth-db';
import { addMemberById, getRole, getSimTitle, listSimsForUser } from '$lib/server/sims/sim-index';
import { deleteAccount } from './deletion';
import {
  user,
  userIdentity,
  userVersion,
  session,
  account,
  passkey,
  handleTombstone,
  simInvite
} from '$lib/server/db/schema';
import { recordUserVersion } from './history';
import { handleAccountLink } from './identity';
import { sha256Hex } from '$lib/sharing/hash';
import { skeleton } from './confusable-skeleton';
import {
  deletedHandle,
  deletedEmail,
  releaseHandle,
  scrubLiveUser,
  hashPriorVersions,
  purgeCredentialsAndSettings,
  markIdentityDeleted
} from './deletion';

const NOW = new Date('2026-06-15T00:00:00Z');

describe('scrubLiveUser', () => {
  test('replaces handle/email/name/image with placeholders', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', name: 'Alice', handle: 'alice' });
    await scrubLiveUser(db, 'id1', 'id1-live', NOW);
    const [u] = await db.select().from(user).where(eq(user.id, 'id1-live'));
    expect(u.handle).toBe(deletedHandle('id1'));
    expect(u.handleSkeleton).toBe(skeleton(deletedHandle('id1')));
    expect(u.email).toBe(deletedEmail('id1'));
    expect(u.name).toBe('Deleted User');
    expect(u.image).toBeNull();
  });
});

describe('releaseHandle', () => {
  test('tombstones the old handle, idempotent on conflict', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await releaseHandle(db, 'id1', 'alice', NOW);
    await releaseHandle(db, 'id1', 'alice', NOW); // no throw
    const rows = await db.select().from(handleTombstone).where(eq(handleTombstone.handle, 'alice'));
    expect(rows).toHaveLength(1);
    expect(rows[0].releasedBy).toBe('id1');
  });
});

describe('hashPriorVersions', () => {
  test('hashes email + name, keeps handle, skips placeholder + already-hashed rows', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await recordUserVersion({
      db,
      identityId: 'id1',
      handle: 'alice',
      name: 'Alice',
      email: 'a@x.com'
    });
    await recordUserVersion({
      db,
      identityId: 'id1',
      handle: deletedHandle('id1'),
      name: 'Deleted User',
      email: deletedEmail('id1')
    });

    await hashPriorVersions(db, ['id1']);

    const rows = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    const real = rows.find((r) => r.handle === 'alice')!;
    expect(real.handle).toBe('alice');
    expect(real.email).toBe(await sha256Hex('a@x.com'));
    // name is normalized: trim + lowercase before hashing — 'Alice' → sha256('alice')
    expect(real.name).toBe(await sha256Hex('Alice'.trim().toLowerCase()));
    const tomb = rows.find((r) => r.email === deletedEmail('id1'))!;
    expect(tomb.name).toBe('Deleted User');

    await hashPriorVersions(db, ['id1']);
    const after = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(after.find((r) => r.handle === 'alice')!.email).toBe(await sha256Hex('a@x.com'));
  });
});

describe('purgeCredentialsAndSettings', () => {
  test('deletes session/account/passkey by user id and invites by identity id', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await db.insert(session).values({
      id: 's1',
      userId: 'id1-live',
      token: 't1',
      expiresAt: NOW,
      createdAt: NOW,
      updatedAt: NOW
    });
    await db.insert(account).values({
      id: 'a1',
      userId: 'id1-live',
      accountId: 'g1',
      providerId: 'google',
      createdAt: NOW,
      updatedAt: NOW
    });
    await db.insert(passkey).values({
      id: 'p1',
      userId: 'id1-live',
      publicKey: 'k',
      credentialID: 'c1',
      counter: 0,
      deviceType: 'platform',
      backedUp: false
    });

    // Seed a second identity to own control invites (must not be purged).
    await seedUser(db, { id: 'id2', email: 'bob@x.com', handle: 'bob' });

    // Two sim_invite rows belonging to id1: one as inviter, one as invitee.
    await db.insert(simInvite).values({
      id: 'qi1',
      simId: 'q1',
      role: 'editor',
      invitedEmail: 'charlie@x.com',
      tokenHash: 'hash1',
      invitedByUserId: 'id1',
      status: 'pending',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86400_000)
    });
    await db.insert(simInvite).values({
      id: 'qi2',
      simId: 'q1',
      role: 'editor',
      invitedUserId: 'id1',
      tokenHash: 'hash2',
      invitedByUserId: 'id2',
      status: 'pending',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86400_000)
    });

    // Control row: invite owned entirely by id2 — must survive the purge.
    await db.insert(simInvite).values({
      id: 'qi3',
      simId: 'q2',
      role: 'editor',
      invitedEmail: 'dave@x.com',
      tokenHash: 'hash3',
      invitedByUserId: 'id2',
      status: 'pending',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86400_000)
    });

    await purgeCredentialsAndSettings(db, 'id1-live', ['id1']);

    expect(await db.select().from(session)).toHaveLength(0);
    expect(await db.select().from(account)).toHaveLength(0);
    expect(await db.select().from(passkey)).toHaveLength(0);

    // id1's invites (qi1 + qi2) are gone; id2's control row (qi3) survives.
    const remainingInvites = await db.select().from(simInvite);
    expect(remainingInvites).toHaveLength(1);
    expect(remainingInvites[0].id).toBe('qi3');
  });

  test('purges fused-in identity invites across the union', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'surv', email: 'surv@x.com', handle: 'surv' });
    await seedUser(db, { id: 'fused', email: 'fused@x.com', handle: 'fused' });
    // mark `fused` as superseded by `surv`
    await db
      .update(userIdentity)
      .set({ supersededById: 'surv', supersededAt: NOW })
      .where(eq(userIdentity.id, 'fused'));
    await db.insert(simInvite).values({
      id: 'inv-fused',
      simId: 'q1',
      role: 'editor',
      tokenHash: 'th-fused',
      invitedByUserId: 'fused',
      status: 'pending',
      createdAt: NOW,
      expiresAt: NOW
    });

    await purgeCredentialsAndSettings(db, 'surv-live', ['surv', 'fused']);

    expect(await db.select().from(simInvite).where(eq(simInvite.id, 'inv-fused'))).toHaveLength(0);
  });
});

describe('markIdentityDeleted', () => {
  test('sets deleted_at', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await markIdentityDeleted(db, 'id1', NOW);
    const [row] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(row.deletedAt).toEqual(NOW);
  });
});

describe('deleteAccount', () => {
  const actor = { actorId: 'id1', actorKind: 'human' as const };
  /** Stands in for platform.env: the fan-out must receive it as given. */
  const env = { marker: 'env' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('tells every sim it left in one fan-out, after the memberships are removed', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    await seedUser(db, { id: 'id2', email: 'bob@x.com', handle: 'bob' });
    const ids = [
      await seedSim(db, { title: 'Solo', managerId: 'id1' }),
      await seedSim(db, { title: 'Shared A', managerId: 'id1' }),
      await seedSim(db, { title: 'Shared B', managerId: 'id1' })
    ];
    await addMemberById({ db, simId: ids[1], userId: 'id2', role: 'editor' });
    await addMemberById({ db, simId: ids[2], userId: 'id2', role: 'viewer' });
    const rolesAtFanOut: (string | null)[] = [];
    vi.mocked(rosterChangedAll).mockImplementationOnce(async (_env, simIds) => {
      for (const simId of simIds) rolesAtFanOut.push(await getRole({ db, simId, userId: 'id1' }));
    });

    await deleteAccount({ db, env, identityId: 'id1', actor });

    expect(rosterChangedAll).toHaveBeenCalledOnce();
    const [givenEnv, givenIds] = vi.mocked(rosterChangedAll).mock.calls[0];
    expect(givenEnv).toBe(env);
    expect([...givenIds].sort()).toEqual([...ids].sort());
    expect(rolesAtFanOut).toEqual([null, null, null]);
    expect(onSimRosterChanged).not.toHaveBeenCalled();
  });

  test('hands the fan-out to defer when the caller gives one, and does not await it', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    const simId = await seedSim(db, { title: 'Solo', managerId: 'id1' });
    const never = new Promise<void>(() => {});
    vi.mocked(rosterChangedAll).mockReturnValueOnce(never);
    const defer = vi.fn();

    await deleteAccount({ db, env, identityId: 'id1', actor, defer });

    expect(rosterChangedAll).toHaveBeenCalledWith(env, [simId]);
    expect(defer).toHaveBeenCalledOnce();
    expect(defer).toHaveBeenCalledWith(never);
    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(idRow.deletedAt).not.toBeNull();
  });

  test('scrubs identity, deletes a sole-member sim, promotes a manager on a shared one, sets deleted_at', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', name: 'Alice', handle: 'alice' });
    await seedUser(db, { id: 'id2', email: 'bob@x.com', handle: 'bob' });
    const solo = await seedSim(db, { title: 'Solo', managerId: 'id1' });
    const shared = await seedSim(db, { title: 'Shared', managerId: 'id1' });
    await addMemberById({ db, simId: shared, userId: 'id2', role: 'editor' });

    await deleteAccount({ db, env, identityId: 'id1', actor });

    expect(await listSimsForUser({ db, userId: 'id1' })).toEqual([]);
    expect(await getSimTitle({ db, simId: solo })).toBeNull();
    expect(await getSimTitle({ db, simId: shared })).toBe('Shared');
    expect(await getRole({ db, simId: shared, userId: 'id2' })).toBe('manager');
    const [u] = await db.select().from(user).where(eq(user.userIdentity, 'id1'));
    expect(u.email).toBe(deletedEmail('id1'));
    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(idRow.deletedAt).not.toBeNull();
  });

  test('removes the sims held through a fused identity: solo deleted, shared handed on', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'pseudo', email: 'p@x.com', handle: 'pseudo' });
    await seedUser(db, { id: 'surv', email: 'surv@x.com', handle: 'surv' });
    await seedUser(db, { id: 'id2', email: 'bob@x.com', handle: 'bob' });
    const solo = await seedSim(db, { title: 'Solo', managerId: 'pseudo' });
    const shared = await seedSim(db, { title: 'Shared', managerId: 'pseudo' });
    await addMemberById({ db, simId: shared, userId: 'id2', role: 'editor' });
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'pseudo-live',
      newUserId: 'surv-live'
    });

    await deleteAccount({
      db,
      env,
      identityId: 'surv',
      actor: { actorId: 'surv', actorKind: 'human' as const }
    });

    expect(await listSimsForUser({ db, userId: 'surv' })).toEqual([]);
    expect(await getSimTitle({ db, simId: solo })).toBeNull();
    expect(await getSimTitle({ db, simId: shared })).toBe('Shared');
    expect(await getRole({ db, simId: shared, userId: 'id2' })).toBe('manager');
    expect(await getRole({ db, simId: shared, userId: 'surv' })).toBeNull();
  });

  test('deleting a sole-member sim removes its pending invites', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    const simId = await seedSim(db, { title: 'Solo', managerId: 'id1' });
    await db.insert(simInvite).values({
      id: 'inv1',
      simId,
      role: 'editor',
      invitedEmail: 'c@x.com',
      tokenHash: 'h1',
      invitedByUserId: 'id1',
      status: 'pending',
      createdAt: NOW,
      expiresAt: NOW
    });

    await deleteAccount({ db, env, identityId: 'id1', actor });

    expect(await db.select().from(simInvite)).toHaveLength(0);
  });

  test('erases PII for an identity fused into the survivor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'surv', email: 'surv@x.com', name: 'Survivor', handle: 'surv' });
    await seedUser(db, { id: 'fused', email: 'fused@x.com', name: 'Fused', handle: 'fused' });
    // Fuse `fused` into `surv`.
    await db
      .update(userIdentity)
      .set({ supersededById: 'surv', supersededAt: NOW })
      .where(eq(userIdentity.id, 'fused'));
    await db.insert(simInvite).values({
      id: 'inv-fused',
      simId: 'q1',
      role: 'editor',
      tokenHash: 'th-fused',
      invitedByUserId: 'fused',
      status: 'pending',
      createdAt: NOW,
      expiresAt: NOW
    });
    await recordUserVersion({
      db,
      identityId: 'fused',
      handle: 'fused',
      name: 'Fused',
      email: 'fused@x.com'
    });

    await deleteAccount({
      db,
      env,
      identityId: 'surv',
      actor: { actorId: 'surv', actorKind: 'human' as const }
    });

    // Fused-in identity's invites purged.
    expect(await db.select().from(simInvite).where(eq(simInvite.id, 'inv-fused'))).toHaveLength(0);
    // Fused-in identity's prior-version email is now hashed.
    const fusedVersions = await db
      .select()
      .from(userVersion)
      .where(eq(userVersion.userIdentity, 'fused'));
    expect(fusedVersions.find((r) => r.handle === 'fused')!.email).toBe(
      await sha256Hex('fused@x.com')
    );
    // Survivor tombstoned.
    const [survRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'surv'));
    expect(survRow.deletedAt).not.toBeNull();
  });

  test('releases the handle, hashes prior versions and drops credentials', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', name: 'Alice', handle: 'alice' });
    await recordUserVersion({
      db,
      identityId: 'id1',
      handle: 'alice',
      name: 'Alice',
      email: 'alice@x.com'
    });
    await db.insert(session).values({
      id: 's1',
      userId: 'id1-live',
      token: 't1',
      expiresAt: NOW,
      createdAt: NOW,
      updatedAt: NOW
    });

    await deleteAccount({ db, env, identityId: 'id1', actor });

    const tomb = await db.select().from(handleTombstone).where(eq(handleTombstone.handle, 'alice'));
    expect(tomb).toHaveLength(1);
    expect(await db.select().from(session)).toHaveLength(0);
    const versions = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(versions.find((r) => r.handle === 'alice')!.email).toBe(await sha256Hex('alice@x.com'));
  });

  test('is a no-op when already deleted (deleted_at gate)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    await deleteAccount({ db, env, identityId: 'id1', actor });
    const before = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    await deleteAccount({ db, env, identityId: 'id1', actor });
    const after = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(after).toHaveLength(before.length);
  });

  test('is a no-op for an unknown identity', async () => {
    const { db } = freshDb();
    await deleteAccount({ db, env, identityId: 'nobody', actor });
    expect(await db.select().from(userIdentity)).toHaveLength(0);
  });

  test('marks the identity deleted last: a failure in a prior step leaves it live', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'delete') {
          return () => {
            throw new Error('boom');
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    }) as typeof db;

    await expect(deleteAccount({ db: failing, env, identityId: 'id1', actor })).rejects.toThrow(
      'boom'
    );

    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(idRow.deletedAt).toBeNull();
  });
});
