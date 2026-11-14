import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { account, passkey, user } from '$lib/server/db/schema';
import { hasPassword, mayRemovePassword } from './password-credential';

async function liveUserId(
  db: ReturnType<typeof freshDb>['db'],
  identityId: string
): Promise<string> {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.userIdentity, identityId));
  return u.id;
}

async function addCredential(db: ReturnType<typeof freshDb>['db'], uid: string) {
  const now = new Date();
  await db.insert(account).values({
    id: `cred-${uid}`,
    userId: uid,
    accountId: uid,
    providerId: 'credential',
    password: 'hashed',
    createdAt: now,
    updatedAt: now
  });
}

describe('hasPassword', () => {
  it('is false with no credential row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    expect(await hasPassword(db, 'u1')).toBe(false);
  });

  it('is true with a credential row', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u2', email: 'u2@test.com' });
    await addCredential(db, await liveUserId(db, 'u2'));
    expect(await hasPassword(db, 'u2')).toBe(true);
  });
});

describe('mayRemovePassword', () => {
  it('is false when the password is the only way back in', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u3', email: 'u3@pseudonymous.sfhousing.invalid' });
    await addCredential(db, await liveUserId(db, 'u3'));
    expect(await mayRemovePassword(db, 'u3')).toBe(false);
  });

  it('is true when a passkey also exists', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u4', email: 'u4@pseudonymous.sfhousing.invalid' });
    const uid = await liveUserId(db, 'u4');
    await addCredential(db, uid);
    await db.insert(passkey).values({
      id: 'pk1',
      publicKey: 'pub',
      userId: uid,
      credentialID: 'cred-1',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false
    });
    expect(await mayRemovePassword(db, 'u4')).toBe(true);
  });

  it('is true when a verified real email exists', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u5', email: 'ada@example.com' });
    const uid = await liveUserId(db, 'u5');
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, uid));
    await addCredential(db, uid);
    expect(await mayRemovePassword(db, 'u5')).toBe(true);
  });

  it('is false when the only email is the synthetic one, even if flagged verified', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u6', email: 'u6@pseudonymous.sfhousing.invalid' });
    const uid = await liveUserId(db, 'u6');
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, uid));
    await addCredential(db, uid);
    expect(await mayRemovePassword(db, 'u6')).toBe(false);
  });

  it('is true when there is no password to remove (vacuously permitted)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u7', email: 'u7@pseudonymous.sfhousing.invalid' });
    expect(await mayRemovePassword(db, 'u7')).toBe(true);
  });

  it('is false when the only other account row is an unrecognized provider', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u8', email: 'u8@pseudonymous.sfhousing.invalid' });
    const uid = await liveUserId(db, 'u8');
    await addCredential(db, uid);
    const now = new Date();
    await db.insert(account).values({
      id: `future-${uid}`,
      userId: uid,
      accountId: uid,
      providerId: 'some-future-provider',
      createdAt: now,
      updatedAt: now
    });
    expect(await mayRemovePassword(db, 'u8')).toBe(false);
  });
});
