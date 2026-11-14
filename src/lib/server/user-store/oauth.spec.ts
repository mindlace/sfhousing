import { describe, it, expect } from 'vitest';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { account } from '$lib/server/db/schema';
import { userHasOAuthAccount } from './oauth';

async function seedAccount(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  liveUserId: string,
  providerId: string
) {
  await db.insert(account).values({
    id: `acct-${liveUserId}-${providerId}`,
    userId: liveUserId,
    accountId: liveUserId,
    providerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

describe('userHasOAuthAccount', () => {
  it('false when the user has no account rows', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'U', email: 'u@x.com' });
    expect(await userHasOAuthAccount(db, 'U-live')).toBe(false);
  });

  it('false when the only account is a credential (email-link) row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'U', email: 'u@x.com' });
    await seedAccount(db, 'U-live', 'credential');
    expect(await userHasOAuthAccount(db, 'U-live')).toBe(false);
  });

  it('true when the user has a google account', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'U', email: 'u@x.com' });
    await seedAccount(db, 'U-live', 'google');
    expect(await userHasOAuthAccount(db, 'U-live')).toBe(true);
  });

  it('true when the user has both google and credential accounts', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'U', email: 'u@x.com' });
    await seedAccount(db, 'U-live', 'credential');
    await seedAccount(db, 'U-live', 'google');
    expect(await userHasOAuthAccount(db, 'U-live')).toBe(true);
  });
});
