import { describe, it, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, seedIdentity } from '$lib/server/test/auth-db';
import { user, userIdentity } from '$lib/server/db/schema';
import {
  getUser,
  getUsers,
  getUserByHandle,
  getUserByEmail,
  resolveHandleOrEmailToUser,
  resolveSessionUser,
  isDeletedIdentity
} from './user';
import { createIdentityForNewVersion } from './identity';

describe('user-store read seam', () => {
  it('getUser returns the canonical User from the live row', async () => {
    const { db } = freshDb();
    await seedUser(db, {
      id: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      handle: 'tester'
    });
    expect(await getUser(db, 'u1')).toMatchObject({
      id: 'u1',
      handle: 'tester',
      name: 'Test User',
      email: 'test@example.com'
    });
  });

  it('getUser returns null for unknown identity', async () => {
    const { db } = freshDb();
    expect(await getUser(db, 'nonexistent')).toBeNull();
  });

  it('getUser follows supersededById to the survivor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'B', email: 'b@example.com', name: 'B User', handle: 'b-handle' });
    await seedIdentity(db, { id: 'A', supersededById: 'B' });
    const u = await getUser(db, 'A');
    expect(u?.id).toBe('B');
    expect(u?.handle).toBe('b-handle');
  });

  it('getUsers batch-resolves and keys by the requested (fused) id', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'B', email: 'b@example.com', handle: 'b-handle' });
    await seedIdentity(db, { id: 'A', supersededById: 'B' });
    const m = await getUsers(db, ['A', 'B']);
    expect(m.size).toBe(2);
    expect(m.get('A')?.id).toBe('B');
    expect(m.get('B')?.id).toBe('B');
  });

  it('getUsers returns empty map for empty input', async () => {
    const { db } = freshDb();
    expect((await getUsers(db, [])).size).toBe(0);
  });

  it('getUser returns null when the survivor has no live row (dead-end)', async () => {
    const { db } = freshDb();
    await seedIdentity(db, { id: 'B' });
    await seedIdentity(db, { id: 'A', supersededById: 'B' });
    expect(await getUser(db, 'A')).toBeNull();
  });

  it('survivorId throws when the chain exceeds the depth cap', async () => {
    const { db } = freshDb();
    // Seed leaf-to-root so supersededById targets already exist as principals
    for (let i = 9; i >= 0; i--) {
      await seedIdentity(db, {
        id: `hop-${i}`,
        supersededById: i < 9 ? `hop-${i + 1}` : undefined
      });
    }
    await expect(getUser(db, 'hop-0')).rejects.toThrow('superseded_by_id chain exceeded 8 hops');
  });

  it('resolveSessionUser maps a live user id to its survivor User', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'carol@example.com', handle: 'carol' });
    const u = await resolveSessionUser(db, 'u1-live');
    expect(u?.id).toBe('u1');
    expect(u?.handle).toBe('carol');
  });

  it('resolveSessionUser returns null for unknown user id', async () => {
    const { db } = freshDb();
    expect(await resolveSessionUser(db, 'nope')).toBeNull();
  });

  it('maps is_anonymous onto User.pseudonymous', async () => {
    const { db } = freshDb();
    const cols = await createIdentityForNewVersion({ db });
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
    const u = await getUser(db, cols.userIdentity);
    expect(u?.pseudonymous).toBe(true);
  });
});

describe('isDeletedIdentity', () => {
  test('false for a live identity, true once deleted_at is set', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    expect(await isDeletedIdentity(db, 'id1')).toBe(false);
    await db.update(userIdentity).set({ deletedAt: new Date() }).where(eq(userIdentity.id, 'id1'));
    expect(await isDeletedIdentity(db, 'id1')).toBe(true);
  });

  test('follows the survivor pointer', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'surv', email: 's@x.com', handle: 'surv' });
    await seedUser(db, { id: 'fused', email: 'f@x.com', handle: 'fused' });
    await db
      .update(userIdentity)
      .set({ supersededById: 'surv' })
      .where(eq(userIdentity.id, 'fused'));
    await db.update(userIdentity).set({ deletedAt: new Date() }).where(eq(userIdentity.id, 'surv'));
    expect(await isDeletedIdentity(db, 'fused')).toBe(true);
  });
});

describe('resolveSessionUser deleted backstop', () => {
  test('returns null when the resolved identity is deleted', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    expect(await resolveSessionUser(db, 'id1-live')).not.toBeNull();
    await db.update(userIdentity).set({ deletedAt: new Date() }).where(eq(userIdentity.id, 'id1'));
    expect(await resolveSessionUser(db, 'id1-live')).toBeNull();
  });
});

describe('getUserByHandle', () => {
  it('resolves a handle to the canonical User', async () => {
    const { db } = freshDb();
    await seedUser(db, {
      id: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      handle: 'tester'
    });
    const u = await getUserByHandle(db, 'tester');
    expect(u?.id).toBe('u1');
    expect(u?.handle).toBe('tester');
  });

  it('tolerates a leading @ and surrounding whitespace', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'test@example.com', handle: 'tester' });
    expect((await getUserByHandle(db, '  @tester '))?.id).toBe('u1');
  });

  it('returns null for an unknown handle', async () => {
    const { db } = freshDb();
    expect(await getUserByHandle(db, 'ghost')).toBeNull();
  });

  it('returns null for an empty handle', async () => {
    const { db } = freshDb();
    expect(await getUserByHandle(db, '   ')).toBeNull();
  });
});

describe('getUserByEmail', () => {
  it('resolves an email to the canonical User', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'test@example.com', handle: 'tester' });
    const u = await getUserByEmail(db, 'test@example.com');
    expect(u?.id).toBe('u1');
    expect(u?.handle).toBe('tester');
  });

  it('matches case-insensitively and tolerates surrounding whitespace', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'Test@Example.com', handle: 'tester' });
    expect((await getUserByEmail(db, '  test@example.COM '))?.id).toBe('u1');
  });

  it('resolves even when the email is unverified', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'x@y.com', handle: 'ecks', emailVerified: false });
    expect((await getUserByEmail(db, 'x@y.com'))?.id).toBe('u1');
  });

  it('returns null for an unknown email', async () => {
    const { db } = freshDb();
    expect(await getUserByEmail(db, 'ghost@nowhere.com')).toBeNull();
  });

  it('returns null for an empty email', async () => {
    const { db } = freshDb();
    expect(await getUserByEmail(db, '   ')).toBeNull();
  });
});

describe('resolveHandleOrEmailToUser', () => {
  it('routes an @-containing value to the email lookup', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'sam@example.com', handle: 'sammy' });
    expect((await resolveHandleOrEmailToUser(db, 'sam@example.com'))?.id).toBe('u1');
  });

  it('routes a plain value to the handle lookup', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'sam@example.com', handle: 'sammy' });
    expect((await resolveHandleOrEmailToUser(db, 'sammy'))?.id).toBe('u1');
  });

  it('strips one leading @ and treats the rest as a handle', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'sam@example.com', handle: 'sammy' });
    expect((await resolveHandleOrEmailToUser(db, '  @sammy '))?.id).toBe('u1');
  });

  it('returns null when the email matches no user', async () => {
    const { db } = freshDb();
    expect(await resolveHandleOrEmailToUser(db, 'ghost@nowhere.com')).toBeNull();
  });

  it('returns null when the handle matches no user', async () => {
    const { db } = freshDb();
    expect(await resolveHandleOrEmailToUser(db, 'ghost')).toBeNull();
  });

  it('returns null for an empty identifier', async () => {
    const { db } = freshDb();
    expect(await resolveHandleOrEmailToUser(db, '  ')).toBeNull();
  });
});
