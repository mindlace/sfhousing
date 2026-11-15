import { describe, it, expect } from 'vitest';
import { SIMS_COPY } from '$lib/members/copy';
import { freshDb, seedManagedSims, seedUser } from '$lib/server/test/auth-db';
import { removeSimMember } from './sims';
import { MAX_SIMS_PER_MANAGER, simQuotaExceeded } from './sim-quota';

async function manage(n: number) {
  const { db } = freshDb();
  await seedUser(db, { id: 'owner1', email: 'm@test.com' });
  const ids = await seedManagedSims(db, { managerId: 'owner1', count: n });
  return { db, ids };
}

describe('simQuotaExceeded', () => {
  it('is 1,000 managed sims, and says so', () => {
    expect(MAX_SIMS_PER_MANAGER).toBe(1000);
    expect(SIMS_COPY.quota).toBe('You can manage up to 1,000 sims.');
  });

  it('returns the quota copy at the cap, and null again after leaving one', async () => {
    const { db, ids } = await manage(MAX_SIMS_PER_MANAGER);
    expect(await simQuotaExceeded(db, { id: 'owner1' })).toBe(SIMS_COPY.quota);
    // A sim with no members counts for nobody, so leaving frees a place.
    await removeSimMember({ db, env: undefined, simId: ids[0], userId: 'owner1' });
    expect(await simQuotaExceeded(db, { id: 'owner1' })).toBeNull();
  });

  it('returns null under the cap', async () => {
    const { db } = await manage(MAX_SIMS_PER_MANAGER - 1);
    expect(await simQuotaExceeded(db, { id: 'owner1' })).toBeNull();
  });
});
