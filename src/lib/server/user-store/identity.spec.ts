import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb } from '$lib/server/test/auth-db';
import { user, userIdentity } from '$lib/server/db/schema';
import { createIdentityForNewVersion, handleAccountLink } from './identity';
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

  it('a fuse calls onFuse once with (survivor, absorbed) after the absorbed identity is superseded', async () => {
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
    let supersededByAtCall: string | null | undefined;
    const onFuse = vi.fn(async (_survivor: string, absorbed: string) => {
      supersededByAtCall = (await getIdentity(db, absorbed))?.supersededById;
    });
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'u-exist',
      onFuse
    });
    expect(onFuse).toHaveBeenCalledTimes(1);
    expect(onFuse).toHaveBeenCalledWith(existing.userIdentity, pseudo.userIdentity);
    expect(supersededByAtCall).toBe(existing.userIdentity);
  });

  it('an upgrade never calls onFuse', async () => {
    const { db } = freshDb();
    await mintLive(db, { id: 'u-pseudo', email: 'p@pseudonymous.sfhousing.invalid' });
    await mintLive(db, { pseudonymous: false, id: 'u-fresh', email: 'real@x.com' });
    const onFuse = vi.fn(async () => {});
    await handleAccountLink({
      db,
      isUpgrade: true,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'u-fresh',
      onFuse
    });
    expect(onFuse).not.toHaveBeenCalled();
  });

  it('a link whose new row already resolves to the pseudonymous identity never calls onFuse', async () => {
    const { db } = freshDb();
    const pseudo = await mintLive(db, {
      id: 'u-pseudo',
      email: 'p@pseudonymous.sfhousing.invalid'
    });
    const fresh = await mintLive(db, { pseudonymous: false, id: 'u-fresh', email: 'real@x.com' });
    await db
      .update(userIdentity)
      .set({ supersededById: pseudo.userIdentity, supersededAt: new Date() })
      .where(eq(userIdentity.id, fresh.userIdentity));
    const onFuse = vi.fn(async () => {});
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'u-fresh',
      onFuse
    });
    expect(onFuse).not.toHaveBeenCalled();
  });

  it('a link with a missing live row never calls onFuse', async () => {
    const { db } = freshDb();
    await mintLive(db, { id: 'u-pseudo', email: 'p@pseudonymous.sfhousing.invalid' });
    const onFuse = vi.fn(async () => {});
    await handleAccountLink({
      db,
      isUpgrade: false,
      pseudonymousUserId: 'u-pseudo',
      newUserId: 'nobody',
      onFuse
    });
    expect(onFuse).not.toHaveBeenCalled();
  });

  it('a rejecting onFuse rejects handleAccountLink, with the fuse already written', async () => {
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
    await expect(
      handleAccountLink({
        db,
        isUpgrade: false,
        pseudonymousUserId: 'u-pseudo',
        newUserId: 'u-exist',
        onFuse: async () => {
          throw new Error('move failed');
        }
      })
    ).rejects.toThrow('move failed');
    const ident = await getIdentity(db, pseudo.userIdentity);
    expect(ident?.supersededById).toBe(existing.userIdentity);
  });
});
