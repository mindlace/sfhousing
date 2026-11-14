import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { user, userVersion, handleTombstone } from '$lib/server/db/schema';
import { isHandleAvailable, updateProfile } from './profile';
import { skeleton } from './confusable-skeleton';

describe('isHandleAvailable', () => {
  test('available when no live user and no tombstone holds the skeleton', async () => {
    const { db } = freshDb();
    expect(await isHandleAvailable(db, skeleton('free-handle'), new Date('2026-06-08'))).toBe(true);
  });

  test('unavailable when a live user holds the skeleton', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', handle: 'taken' });
    expect(await isHandleAvailable(db, skeleton('taken'), new Date('2026-06-08'))).toBe(false);
  });

  test('unavailable when a non-expired tombstone holds the skeleton', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', handle: 'alice' });
    await db.insert(handleTombstone).values({
      handle: 'rented',
      skeleton: skeleton('rented'),
      releasedBy: 'id-1',
      releasedAt: new Date('2026-06-01'),
      expiresAt: new Date('2027-06-01')
    });
    expect(await isHandleAvailable(db, skeleton('rented'), new Date('2026-06-08'))).toBe(false);
  });

  test('available when the tombstone has expired', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', handle: 'alice' });
    await db.insert(handleTombstone).values({
      handle: 'expired',
      skeleton: skeleton('expired'),
      releasedBy: 'id-1',
      releasedAt: new Date('2025-01-01'),
      expiresAt: new Date('2026-01-01')
    });
    expect(await isHandleAvailable(db, skeleton('expired'), new Date('2026-06-08'))).toBe(true);
  });
});

describe('updateProfile', () => {
  test('rejects an invalid handle without writing', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const r = await updateProfile(db, 'id-1', { handle: 'ad min' }, new Date('2026-06-08'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('Handles can only use letters, numbers, and single hyphens.');
  });

  test('rejects a handle whose skeleton collides with another user (digit-fold)', async () => {
    const { db } = freshDb();
    // Live user @bob (skeleton 'bob'). Attacker attempts 'b0b' (digit zero U+0030),
    // a single-script-valid handle whose skeleton also folds to 'bob' → already taken.
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    await seedUser(db, { id: 'id-2', email: 'b@x.com', name: 'Bob', handle: 'bob' });
    const r = await updateProfile(db, 'id-1', { handle: 'b0b' }, new Date('2026-06-08'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('That handle is already taken.');
  });

  test('rejects a mixed-script confusable before the availability check', async () => {
    const { db } = freshDb();
    // Greek omicron U+03BF inside an otherwise-Latin handle → mixed-script rejection.
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    await seedUser(db, { id: 'id-2', email: 'b@x.com', name: 'Bob', handle: 'bobby' });
    const r = await updateProfile(db, 'id-1', { handle: 'bοbby' }, new Date('2026-06-08'));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.reason).toBe('Handles must use a single script — please do not mix alphabets.');
  });

  test('changes the handle: updates live row + skeletons, tombstones the old handle for 1 year, records history', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const now = new Date('2026-06-08T00:00:00Z');
    const r = await updateProfile(db, 'id-1', { handle: 'alice-otter' }, now);
    expect(r).toMatchObject({ ok: true, handleChanged: true });

    const liveUser = await db.select().from(user).where(eq(user.userIdentity, 'id-1'));
    expect(liveUser[0].handle).toBe('alice-otter');
    expect(liveUser[0].handleSkeleton).toBe(skeleton('alice-otter'));

    const tomb = await db.select().from(handleTombstone).where(eq(handleTombstone.handle, 'alice'));
    expect(tomb[0].releasedBy).toBe('id-1');
    expect(tomb[0].skeleton).toBe(skeleton('alice'));
    expect(tomb[0].expiresAt.getTime()).toBe(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const versions = await db
      .select()
      .from(userVersion)
      .where(eq(userVersion.userIdentity, 'id-1'));
    expect(versions.some((v) => v.handle === 'alice-otter')).toBe(true);
  });

  test('rejects a handle change within the 7-day cooldown', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    await db.insert(handleTombstone).values({
      handle: 'old-one',
      skeleton: skeleton('old-one'),
      releasedBy: 'id-1',
      releasedAt: new Date('2026-06-06'),
      expiresAt: new Date('2027-06-06')
    });
    const r = await updateProfile(db, 'id-1', { handle: 'brand-new' }, new Date('2026-06-08'));
    expect(r.ok).toBe(false);
  });

  test('updates the display name without touching the handle', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const r = await updateProfile(db, 'id-1', { name: 'Alice Liddell' }, new Date('2026-06-08'));
    expect(r).toMatchObject({ ok: true, handleChanged: false });
    const liveUser = await db.select().from(user).where(eq(user.userIdentity, 'id-1'));
    expect(liveUser[0].name).toBe('Alice Liddell');
    expect(liveUser[0].handle).toBe('alice');
  });

  test('rejects a display name longer than 60 chars', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const r = await updateProfile(db, 'id-1', { name: 'x'.repeat(61) }, new Date('2026-06-08'));
    expect(r.ok).toBe(false);
  });

  test('measures the display-name cap on the NFC form', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const nfdName = ('e' + '́').repeat(60); // 120 NFD code points; 60 NFC code points
    const result = await updateProfile(db, 'id-1', { name: nfdName }, new Date('2026-06-08'));
    expect(result.ok).toBe(true);
  });

  test('no-op when the submitted handle equals the current handle', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const r = await updateProfile(db, 'id-1', { handle: 'alice' }, new Date('2026-06-08'));
    expect(r).toMatchObject({ ok: true, handleChanged: false });
    const tomb = await db.select().from(handleTombstone);
    expect(tomb.length).toBe(0);
  });

  test('returns the stored, normalized handle and name', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id-1', email: 'a@x.com', name: 'Alice', handle: 'alice' });
    const res = await updateProfile(
      db,
      'id-1',
      { handle: 'Ada-L', name: '  Ada  ' },
      new Date('2026-06-08')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // validateHandle case-folds; the display name is trimmed + NFC-normalized.
    expect(res.handle).toBe('ada-l');
    expect(res.name).toBe('Ada');
  });
});
