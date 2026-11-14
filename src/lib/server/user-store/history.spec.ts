import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedIdentity } from '$lib/server/test/auth-db';
import { userVersion } from '$lib/server/db/schema';
import { recordUserVersion, getUserHistory } from './history';

describe('recordUserVersion', () => {
  it('appends exactly one history row with the supplied fields', async () => {
    const { db } = freshDb();
    await seedIdentity(db, { id: 'A' });

    await recordUserVersion({ db, identityId: 'A', handle: 'h1', name: 'N1', email: 'a@x' });

    const rows = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'A'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userIdentity: 'A', handle: 'h1', name: 'N1', email: 'a@x' });
    expect(rows[0].capturedAt).toBeInstanceOf(Date);
  });

  it('appends a new row per call (never overwrites)', async () => {
    const { db } = freshDb();
    await seedIdentity(db, { id: 'A' });
    await recordUserVersion({ db, identityId: 'A', handle: 'h1', name: 'N1', email: 'a@x' });
    await recordUserVersion({ db, identityId: 'A', handle: 'h2', name: 'N2', email: 'a@x' });
    const rows = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'A'));
    expect(rows).toHaveLength(2);
  });
});

describe('getUserHistory', () => {
  it('assembles the trail across a fused identity, ordered by capturedAt', async () => {
    const { db } = freshDb();
    await seedIdentity(db, { id: 'S' });
    await seedIdentity(db, { id: 'A', supersededById: 'S' });

    await recordUserVersion({ db, identityId: 'A', handle: 'a-old', name: 'A', email: 'a@x' });
    await recordUserVersion({ db, identityId: 'S', handle: 's-now', name: 'S', email: 's@x' });

    const trail = await getUserHistory(db, 'S');
    expect(trail.map((r) => r.handle)).toEqual(['a-old', 's-now']);
  });

  it("returns only the survivor's own rows when nothing fused in", async () => {
    const { db } = freshDb();
    await seedIdentity(db, { id: 'S' });
    await recordUserVersion({ db, identityId: 'S', handle: 's', name: 'S', email: 's@x' });
    const trail = await getUserHistory(db, 'S');
    expect(trail).toHaveLength(1);
  });
});
