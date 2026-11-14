import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { account, passkey, user } from '$lib/server/db/schema';
import { hasStrongAuthFactor } from './auth-factors';

async function liveUserId(
  db: ReturnType<typeof freshDb>['db'],
  identityId: string
): Promise<string> {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.userIdentity, identityId));
  return u.id;
}

describe('hasStrongAuthFactor', () => {
  it('is false for a magic-link-only account (no account, no passkey)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    expect(await hasStrongAuthFactor(db, 'u1')).toBe(false);
  });

  it('is true when the identity has an OAuth account row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u2', email: 'u2@test.com' });
    const uid = await liveUserId(db, 'u2');
    const now = new Date();
    await db.insert(account).values({
      id: 'acc1',
      userId: uid,
      accountId: 'google-sub-123',
      providerId: 'google',
      createdAt: now,
      updatedAt: now
    });
    expect(await hasStrongAuthFactor(db, 'u2')).toBe(true);
  });

  it('is true when the identity has a passkey credential', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u3', email: 'u3@test.com' });
    const uid = await liveUserId(db, 'u3');
    await db.insert(passkey).values({
      id: 'pk1',
      publicKey: 'pub-key-bytes',
      userId: uid,
      credentialID: 'cred-1',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false
    });
    expect(await hasStrongAuthFactor(db, 'u3')).toBe(true);
  });

  it('is false for an unknown identity id', async () => {
    const { db } = freshDb();
    expect(await hasStrongAuthFactor(db, 'nobody')).toBe(false);
  });

  it('is true when the identity has a password credential', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u4', email: 'u4@test.com' });
    const uid = await liveUserId(db, 'u4');
    const now = new Date();
    await db.insert(account).values({
      id: 'acc-cred',
      userId: uid,
      accountId: uid,
      providerId: 'credential',
      password: 'hashed:argon2id:xxx',
      createdAt: now,
      updatedAt: now
    });
    expect(await hasStrongAuthFactor(db, 'u4')).toBe(true);
  });

  it('ignores an account row whose provider is not a recognised strong factor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u5', email: 'u5@test.com' });
    const uid = await liveUserId(db, 'u5');
    const now = new Date();
    await db.insert(account).values({
      id: 'acc-unknown',
      userId: uid,
      accountId: 'whatever',
      providerId: 'some-future-provider',
      createdAt: now,
      updatedAt: now
    });
    expect(await hasStrongAuthFactor(db, 'u5')).toBe(false);
  });
});
