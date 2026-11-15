import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedSim } from '$lib/server/test/auth-db';
import { rosterChangedAll } from '$lib/server/sims/roster-hook';
import { foldSimsForUser } from '$lib/server/sims/sim-roles';
import { user, userIdentity, userVersion } from '$lib/server/db/schema';
import { createIdentityForNewVersion, reseedHandleFromSim, handleAccountLink } from './identity';
import { skeleton } from './confusable-skeleton';
import { getUser } from './user';

vi.mock('$lib/server/sims/roster-hook', () => ({
  rosterChangedAll: vi.fn(async () => {})
}));
vi.mock('$lib/server/sims/sim-roles', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/server/sims/sim-roles')>();
  return { ...real, foldSimsForUser: vi.fn(real.foldSimsForUser) };
});

async function getIdentity(db: Awaited<ReturnType<typeof freshDb>>['db'], identityId: string) {
  const rows = await db.select().from(userIdentity).where(eq(userIdentity.id, identityId));
  return rows[0] ?? null;
}

describe('createIdentityForNewVersion', () => {
  it('no displayName: inserts a user_identity row and returns whimsical head cols', async () => {
    const { db } = freshDb();
    const cols = await createIdentityForNewVersion({ db });
    expect(cols.handle).toMatch(/^[a-z]+-[a-z]+$/);
    const row = await getIdentity(db, cols.userIdentity);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(cols.userIdentity);
    expect(cols.handleSkeleton).toBe(skeleton(cols.handle));
  });

  it('with displayName: handle seeded from the first word', async () => {
    const { db } = freshDb();
    const cols = await createIdentityForNewVersion({ db, displayName: 'Move to Portland' });
    expect(cols.handle).toMatch(/^move-/);
  });

  it('pseudonymous: true is returned as isAnonymous for the auth adapter', async () => {
    const { db } = freshDb();
    const cols = await createIdentityForNewVersion({ db, pseudonymous: true });
    expect(cols.isAnonymous).toBe(true);
  });

  it('defaults to non-pseudonymous', async () => {
    const { db } = freshDb();
    const cols = await createIdentityForNewVersion({ db });
    expect(cols.isAnonymous).toBe(false);
  });
});

describe('reseedHandleFromSim', () => {
  it('reseeds handle+name from the sim title and snapshots history', async () => {
    const { db } = freshDb();
    const cols = await createIdentityForNewVersion({ db, pseudonymous: true });
    await db.insert(user).values({
      id: 'live-pseudo',
      name: cols.handle,
      email: 'live-pseudo@pseudonymous.sfhousing.invalid',
      userIdentity: cols.userIdentity,
      handle: cols.handle,
      handleSkeleton: cols.handleSkeleton,
      isAnonymous: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const handle = await reseedHandleFromSim({
      db,
      identityId: cols.userIdentity,
      simTitle: 'Garden Party'
    });
    expect(handle).toMatch(/^garden/);
    const [row] = await db.select().from(user).where(eq(user.userIdentity, cols.userIdentity));
    expect(row.handle).toBe(handle);
    expect(row.name).toBe(handle);
    const versions = await db
      .select()
      .from(userVersion)
      .where(eq(userVersion.userIdentity, cols.userIdentity));
    expect(versions.map((v) => v.handle)).toContain(handle);
  });
});

describe('handleAccountLink', () => {
  async function mintLive(
    db: Awaited<ReturnType<typeof freshDb>>['db'],
    { pseudonymous = true, id, email }: { pseudonymous?: boolean; id: string; email: string }
  ) {
    const cols = await createIdentityForNewVersion({ db, pseudonymous });
    await db.insert(user).values({
      id,
      email,
      name: cols.handle,
      userIdentity: cols.userIdentity,
      handle: cols.handle,
      handleSkeleton: cols.handleSkeleton,
      isAnonymous: pseudonymous,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return cols;
  }

  it('upgrade: pseudonymous identity survives, fresh row re-pointed with the pseudo handle', async () => {
    const { db } = freshDb();
    const pseudo = await mintLive(db, {
      id: 'u-pseudo',
      email: 'p@pseudonymous.sfhousing.invalid'
    });
    const fresh = await mintLive(db, { pseudonymous: false, id: 'u-fresh', email: 'real@x.com' });
    await handleAccountLink({
      db,
      isUpgrade: true,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'u-fresh'
    });
    const [live] = await db.select().from(user).where(eq(user.id, 'u-fresh'));
    expect(live.userIdentity).toBe(pseudo.userIdentity);
    expect(live.handle).toBe(pseudo.handle);
    expect(live.isAnonymous).toBe(false);
    expect(
      await db.select().from(userIdentity).where(eq(userIdentity.id, fresh.userIdentity))
    ).toHaveLength(0);
  });

  it('fuse: pseudo identity superseded by survivor; pseudo live row deleted; history snapshotted', async () => {
    const { db } = freshDb();
    const pseudo = await mintLive(db, {
      id: 'u-pseudo',
      email: 'p@pseudonymous.sfhousing.invalid'
    });
    const existing = await mintLive(db, {
      pseudonymous: false,
      id: 'u-exist',
      email: 'real@x.com'
    });
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'u-exist'
    });
    const [ident] = await db
      .select()
      .from(userIdentity)
      .where(eq(userIdentity.id, pseudo.userIdentity));
    expect(ident.supersededById).toBe(existing.userIdentity);
    expect(await db.select().from(user).where(eq(user.id, 'u-pseudo'))).toHaveLength(0);
    expect(await getUser(db, pseudo.userIdentity)).toMatchObject({ id: existing.userIdentity });
  });

  it('fuse collapses depth-1 star: identities pointing at the pseudo identity re-point to the survivor', async () => {
    const { db } = freshDb();
    const pseudo = await mintLive(db, {
      id: 'u-pseudo',
      email: 'p@pseudonymous.sfhousing.invalid'
    });
    const older = await createIdentityForNewVersion({ db, pseudonymous: true });
    await db
      .update(userIdentity)
      .set({ supersededById: pseudo.userIdentity, supersededAt: new Date() })
      .where(eq(userIdentity.id, older.userIdentity));
    const existing = await mintLive(db, {
      pseudonymous: false,
      id: 'u-exist',
      email: 'real@x.com'
    });
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'u-exist'
    });
    const [o] = await db.select().from(userIdentity).where(eq(userIdentity.id, older.userIdentity));
    expect(o.supersededById).toBe(existing.userIdentity);
  });

  describe('the fuse tells the absorbed identity sims (R49)', () => {
    const env = { tag: 'env' };

    beforeEach(() => {
      vi.mocked(rosterChangedAll).mockClear();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function pair(db: Awaited<ReturnType<typeof freshDb>>['db']) {
      const pseudo = await mintLive(db, {
        id: 'u-pseudo',
        email: 'p@pseudonymous.sfhousing.invalid'
      });
      const surv = await mintLive(db, { pseudonymous: false, id: 'u-exist', email: 'real@x.com' });
      return { pseudo, surv };
    }

    it('a fuse defers one fan-out over exactly the absorbed identity sims', async () => {
      const { db } = freshDb();
      const { pseudo, surv } = await pair(db);
      const a = await seedSim(db, { title: 'A', managerId: pseudo.userIdentity });
      const b = await seedSim(db, { title: 'B', managerId: pseudo.userIdentity });
      await seedSim(db, { title: 'S', managerId: surv.userIdentity });
      const defer = vi.fn();
      await handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'u-pseudo',
        newUserId: 'u-exist',
        roster: { env, defer }
      });
      expect(defer).toHaveBeenCalledTimes(1);
      expect(defer.mock.calls[0][0]).toBeInstanceOf(Promise);
      expect(rosterChangedAll).toHaveBeenCalledTimes(1);
      const [gotEnv, ids] = vi.mocked(rosterChangedAll).mock.calls[0];
      expect(gotEnv).toBe(env);
      expect([...ids].sort()).toEqual([a, b].sort());
    });

    it('a fuse of an identity with no sims tells nobody', async () => {
      const { db } = freshDb();
      await pair(db);
      const defer = vi.fn();
      await handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'u-pseudo',
        newUserId: 'u-exist',
        roster: { env, defer }
      });
      expect(defer).not.toHaveBeenCalled();
      expect(rosterChangedAll).not.toHaveBeenCalled();
    });

    it('an upgrade calls neither defer nor the hook', async () => {
      const { db } = freshDb();
      const { pseudo } = await pair(db);
      await seedSim(db, { title: 'A', managerId: pseudo.userIdentity });
      const defer = vi.fn();
      await handleAccountLink({
        db,
        isUpgrade: true,
        pseudonymousUserId: 'u-pseudo',
        newUserId: 'u-exist',
        roster: { env, defer }
      });
      expect(defer).not.toHaveBeenCalled();
      expect(rosterChangedAll).not.toHaveBeenCalled();
    });

    it('a failed sims read still fuses, logs safe text only and defers nothing', async () => {
      const { db } = freshDb();
      const { pseudo, surv } = await pair(db);
      await seedSim(db, { title: 'Secret title', managerId: pseudo.userIdentity });
      vi.mocked(foldSimsForUser).mockRejectedValueOnce(new Error('boom'));
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const defer = vi.fn();
      await handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'u-pseudo',
        newUserId: 'u-exist',
        roster: { env, defer }
      });
      const [ident] = await db
        .select()
        .from(userIdentity)
        .where(eq(userIdentity.id, pseudo.userIdentity));
      expect(ident.supersededById).toBe(surv.userIdentity);
      expect(await db.select().from(user).where(eq(user.id, 'u-pseudo'))).toHaveLength(0);
      expect(defer).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0][0]).toBe('[fuse] sims read failed');
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(/real@x\.com|Secret title|u-pseudo/);
    });

    it('without roster a fuse reads nothing and tells nobody', async () => {
      const { db } = freshDb();
      const { pseudo } = await pair(db);
      await seedSim(db, { title: 'A', managerId: pseudo.userIdentity });
      vi.mocked(foldSimsForUser).mockClear();
      await handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'u-pseudo',
        newUserId: 'u-exist'
      });
      expect(rosterChangedAll).not.toHaveBeenCalled();
      expect(foldSimsForUser).not.toHaveBeenCalled();
    });
  });
});
