import { describe, it, expect } from 'vitest';
import { asc } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { capabilityEvent } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/base58';
import { insertCapabilityEvent } from './capability-events';

const base = {
  resourceType: 'app',
  resourceId: '*',
  ability: 'x.test',
  action: 'grant' as const,
  actorId: null
};

describe('insertCapabilityEvent', () => {
  it('same-ms inserts get distinct, increasing counters', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'p1', email: 'p1@test.com' });
    const now = new Date(1_700_000_000_000);
    await insertCapabilityEvent(db, { ...base, id: newId(), principalId: 'p1', now });
    await insertCapabilityEvent(db, { ...base, id: newId(), principalId: 'p1', now });
    const rows = await db
      .select()
      .from(capabilityEvent)
      .orderBy(asc(capabilityEvent.createdAt), asc(capabilityEvent.createdAtCounter));
    expect(rows.map((r) => r.createdAtCounter)).toEqual([0, 1]);
    expect(rows.every((r) => r.createdAt.getTime() === now.getTime())).toBe(true);
  });
});
