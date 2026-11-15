import { describe, it, expect } from 'vitest';
import { SIMS_COPY } from '$lib/members/copy';
import { freshDb, seedSim, seedUser } from '$lib/server/test/auth-db';
import { MAX_SIMS_PER_MANAGER, simQuotaExceeded } from './sim-quota';

async function manage(n: number) {
  const { db } = freshDb();
  await seedUser(db, { id: 'owner1', email: 'm@test.com' });
  for (let i = 0; i < n; i++) await seedSim(db, { title: `Sim ${i}`, managerId: 'owner1' });
  return db;
}

describe('simQuotaExceeded', () => {
  it('returns the quota copy at the cap', async () => {
    const db = await manage(MAX_SIMS_PER_MANAGER);
    expect(MAX_SIMS_PER_MANAGER).toBe(5);
    expect(await simQuotaExceeded(db, { id: 'owner1' })).toBe(SIMS_COPY.quota);
  });

  it('returns null under the cap', async () => {
    const db = await manage(MAX_SIMS_PER_MANAGER - 1);
    expect(await simQuotaExceeded(db, { id: 'owner1' })).toBeNull();
  });
});
