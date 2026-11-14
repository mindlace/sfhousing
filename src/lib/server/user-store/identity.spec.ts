import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb } from '$lib/server/test/auth-db';
import { user, userIdentity, userVersion } from '$lib/server/db/schema';
import { createIdentityForNewVersion, reseedHandleFromSim, handleAccountLink } from './identity';
import { skeleton } from './confusable-skeleton';
import { getUser } from './user';

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
});
