import { describe, it, expect } from 'vitest';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { passkey } from '$lib/server/db/schema';
import { userHasPasskey } from './passkey';

async function seedPasskey(db: Awaited<ReturnType<typeof freshDb>>['db'], userLiveId: string) {
  await db.insert(passkey).values({
    id: `pk-${userLiveId}`,
    publicKey: 'pub',
    userId: userLiveId,
    credentialID: `cred-${userLiveId}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false
  });
}

describe('userHasPasskey', () => {
  it('returns false when the user has no passkey', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'U', email: 'u@x.com' });
    expect(await userHasPasskey(db, 'U-live')).toBe(false);
  });

  it('returns true when the user has at least one passkey', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'U', email: 'u@x.com' });
    await seedPasskey(db, 'U-live');
    expect(await userHasPasskey(db, 'U-live')).toBe(true);
  });
});
