import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { APP_RESOURCE, type Capability } from '$lib/server/authz';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { resolveGrantedCapabilities } from './capabilities';
import { grantCapability, revokeCapability } from './grants';

async function targetEvents(db: Database) {
  return db
    .select({ id: schema.capabilityEvent.id })
    .from(schema.capabilityEvent)
    .where(eq(schema.capabilityEvent.principalId, 'target'));
}

describe('grantCapability', () => {
  it('grants a held cap', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [
      { ability: 'cap.grant', resource: APP_RESOURCE },
      { ability: 'cap.revoke', resource: APP_RESOURCE }
    ];
    await grantCapability({
      db,
      actorId: 'actor',
      actorCaps,
      targetId: 'target',
      capability: 'cap.revoke'
    });
    const caps = await resolveGrantedCapabilities(db, 'target');
    expect(caps.some((c) => c.ability === 'cap.revoke')).toBe(true);
  });

  it('rejects escalation (granting a cap the actor does not hold) with no write', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [{ ability: 'cap.grant', resource: APP_RESOURCE }];
    await expect(
      grantCapability({
        db,
        actorId: 'actor',
        actorCaps,
        targetId: 'target',
        capability: 'cap.revoke'
      })
    ).rejects.toThrow();
    expect(await targetEvents(db)).toEqual([]);
  });

  it('rejects when the actor lacks cap.grant', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [{ ability: 'cap.revoke', resource: APP_RESOURCE }];
    await expect(
      grantCapability({
        db,
        actorId: 'actor',
        actorCaps,
        targetId: 'target',
        capability: 'cap.revoke'
      })
    ).rejects.toThrow();
    expect(await targetEvents(db)).toEqual([]);
  });

  it('allows the wildcard holder to grant any operator cap', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [{ ability: '*', resource: APP_RESOURCE }];
    await grantCapability({
      db,
      actorId: 'actor',
      actorCaps,
      targetId: 'target',
      capability: 'cap.grant'
    });
    const caps = await resolveGrantedCapabilities(db, 'target');
    expect(caps.map((c) => c.ability)).toEqual(['cap.grant']);
  });
});

describe('revokeCapability', () => {
  it('revokes a held cap', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [{ ability: '*', resource: APP_RESOURCE }];
    await grantCapability({
      db,
      actorId: 'actor',
      actorCaps,
      targetId: 'target',
      capability: 'cap.grant'
    });
    await revokeCapability({
      db,
      actorId: 'actor',
      actorCaps,
      targetId: 'target',
      capability: 'cap.grant'
    });
    const caps = await resolveGrantedCapabilities(db, 'target');
    expect(caps.length).toBe(0);
  });

  it('rejects revoke when the actor lacks cap.revoke', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [{ ability: 'cap.grant', resource: APP_RESOURCE }];
    await expect(
      revokeCapability({
        db,
        actorId: 'actor',
        actorCaps,
        targetId: 'target',
        capability: 'cap.grant'
      })
    ).rejects.toThrow();
    expect(await targetEvents(db)).toEqual([]);
  });

  it('rejects revoking a cap the actor does not hold', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'target', email: 'target@test.com' });
    const actorCaps: Capability[] = [{ ability: 'cap.revoke', resource: APP_RESOURCE }];
    await expect(
      revokeCapability({
        db,
        actorId: 'actor',
        actorCaps,
        targetId: 'target',
        capability: 'cap.grant'
      })
    ).rejects.toThrow();
    expect(await targetEvents(db)).toEqual([]);
  });
});
