import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { skeleton } from '$lib/server/user-store/confusable-skeleton';
import { freshDb, grantEvent, makePlatform, seedIdentity, seedUser } from './auth-db';

describe('freshDb', () => {
  it('returns independent migrated databases', async () => {
    const a = freshDb();
    const b = freshDb();
    await seedUser(a.db, { id: 'u1', email: 'a@example.com' });
    expect(await a.db.select().from(schema.userIdentity)).toHaveLength(1);
    expect(await b.db.select().from(schema.userIdentity)).toHaveLength(0);
    a.close();
    b.close();
  });
});

describe('seedUser', () => {
  it('writes principal, identity and a live row keyed `${id}-live`', async () => {
    const { db, close } = freshDb();
    await seedUser(db, { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true });
    const [live] = await db.select().from(schema.user);
    expect(live).toMatchObject({
      id: 'u1-live',
      userIdentity: 'u1',
      name: 'Ada',
      handle: 'ada',
      emailVerified: true
    });
    const [p] = await db.select().from(schema.principal);
    expect(p).toEqual({ id: 'u1', kind: 'identity' });
    close();
  });

  it('defaults name to the email and honours an explicit handle', async () => {
    const { db, close } = freshDb();
    await seedUser(db, { id: 'u2', email: 'b@example.com', handle: 'bee' });
    const [live] = await db.select().from(schema.user);
    expect(live).toMatchObject({ name: 'b@example.com', handle: 'bee', emailVerified: false });
    close();
  });
});

describe('seedIdentity', () => {
  it('seeds a bare identity with no live user row', async () => {
    const { db, close } = freshDb();
    await seedIdentity(db, { id: 'i1' });
    const [row] = await db.select().from(schema.userIdentity);
    expect(row).toMatchObject({ id: 'i1', supersededById: null, supersededAt: null });
    expect(await db.select().from(schema.user)).toHaveLength(0);
    close();
  });

  it('records the survivor and fuse time for a superseded identity', async () => {
    const { db, close } = freshDb();
    await seedIdentity(db, { id: 'survivor' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    const [row] = await db
      .select()
      .from(schema.userIdentity)
      .where(eq(schema.userIdentity.id, 'fused'));
    expect(row.supersededById).toBe('survivor');
    expect(row.supersededAt).toBeInstanceOf(Date);
    close();
  });
});

describe('grantEvent', () => {
  it('appends an app-scoped grant by default', async () => {
    const { db, close } = freshDb();
    await seedIdentity(db, { id: 'i1' });
    await grantEvent(db, { identityId: 'i1', capability: 'operator.access' });
    const [row] = await db.select().from(schema.capabilityEvent);
    expect(row).toMatchObject({
      principalId: 'i1',
      resourceType: 'app',
      resourceId: '*',
      ability: 'operator.access',
      action: 'grant',
      actorId: null,
      createdAtCounter: 0
    });
    close();
  });

  it('honours action, at, actorId and counter', async () => {
    const { db, close } = freshDb();
    await seedIdentity(db, { id: 'i1' });
    const at = new Date('2026-01-02T03:04:05Z');
    await grantEvent(db, {
      identityId: 'i1',
      capability: 'x',
      action: 'revoke',
      at,
      actorId: 'boss',
      counter: 3
    });
    const [row] = await db.select().from(schema.capabilityEvent);
    expect(row).toMatchObject({ action: 'revoke', actorId: 'boss', createdAtCounter: 3 });
    expect(row.createdAt.getTime()).toBe(at.getTime());
    close();
  });
});

describe('makePlatform', () => {
  it('binds DB to the shim so getDb reads the seeded database', async () => {
    const { db, shim, close } = freshDb();
    await seedUser(db, { id: 'u1', email: 'a@example.com' });
    const platform = makePlatform(shim);
    expect(await getDb(platform).select().from(schema.user)).toHaveLength(1);
    close();
  });

  it('passes extra env keys through', () => {
    const { shim, close } = freshDb();
    const platform = makePlatform(shim, { ENVIRONMENT: 'development', AUTH_METHODS: 'magic-link' });
    expect(platform.env).toMatchObject({ ENVIRONMENT: 'development', AUTH_METHODS: 'magic-link' });
    expect(platform.env.DB).toBe(shim);
    close();
  });
});

describe('seedUser handleSkeleton', () => {
  it('sets handleSkeleton to skeleton(handle)', async () => {
    const { db, close } = freshDb();
    await seedUser(db, { id: 'u1', email: 'a@example.com', handle: 'r00t' });
    const [row] = await db.select().from(schema.user);
    expect(row.handleSkeleton).toBe(skeleton('r00t'));
    close();
  });
});
