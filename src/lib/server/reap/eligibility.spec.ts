import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { account, passkey, session, user, userIdentity } from '$lib/server/db/schema';
import { selectReapableUsers } from './eligibility';

const HOUR = 3600_000;
const now = 1_800_000_000_000;
const grace = 48 * HOUR;

async function liveUserId(db: ReturnType<typeof freshDb>['db'], identityId: string) {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.userIdentity, identityId));
  return u.id;
}

async function markPseudonymous(db: ReturnType<typeof freshDb>['db'], liveUserId: string) {
  await db.update(user).set({ isAnonymous: true }).where(eq(user.id, liveUserId));
}

async function seedSession(
  db: ReturnType<typeof freshDb>['db'],
  opts: { id: string; userId: string; expiresAt: number }
) {
  const created = new Date();
  await db.insert(session).values({
    id: opts.id,
    userId: opts.userId,
    token: `token-${opts.id}`,
    expiresAt: new Date(opts.expiresAt),
    createdAt: created,
    updatedAt: created
  });
}

describe('selectReapableUsers', () => {
  it('selects a pseudonymous, non-durable user whose sessions all expired past grace', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    const uid = await liveUserId(db, 'u1');
    await markPseudonymous(db, uid);
    await seedSession(db, { id: 's1', userId: uid, expiresAt: now - grace - HOUR });

    const rows = await selectReapableUsers(db, now, grace, 100);

    expect(rows).toEqual([{ liveUserId: uid, identityId: 'u1' }]);
  });

  it('excludes a user whose latest session expires within grace', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u2', email: 'u2@test.com' });
    const uid = await liveUserId(db, 'u2');
    await markPseudonymous(db, uid);
    await seedSession(db, { id: 's2', userId: uid, expiresAt: now - grace + HOUR });

    expect(await selectReapableUsers(db, now, grace, 100)).toEqual([]);
  });

  it('excludes a non-pseudonymous (real) user', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u3', email: 'u3@test.com' });
    const uid = await liveUserId(db, 'u3');
    await seedSession(db, { id: 's3', userId: uid, expiresAt: now - grace - HOUR });

    expect(await selectReapableUsers(db, now, grace, 100)).toEqual([]);
  });

  it('excludes a durable user with a passkey', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u4', email: 'u4@test.com' });
    const uid = await liveUserId(db, 'u4');
    await markPseudonymous(db, uid);
    await seedSession(db, { id: 's4', userId: uid, expiresAt: now - grace - HOUR });
    await db.insert(passkey).values({
      id: 'pk1',
      publicKey: 'pub-key-bytes',
      userId: uid,
      credentialID: 'cred-1',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false
    });

    expect(await selectReapableUsers(db, now, grace, 100)).toEqual([]);
  });

  it('excludes a durable user with a Google account', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u5', email: 'u5@test.com' });
    const uid = await liveUserId(db, 'u5');
    await markPseudonymous(db, uid);
    await seedSession(db, { id: 's5', userId: uid, expiresAt: now - grace - HOUR });
    const nowDate = new Date();
    await db.insert(account).values({
      id: 'acc1',
      userId: uid,
      accountId: 'google-sub-1',
      providerId: 'google',
      createdAt: nowDate,
      updatedAt: nowDate
    });

    expect(await selectReapableUsers(db, now, grace, 100)).toEqual([]);
  });

  it('excludes a durable user with a password credential', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u8', email: 'u8@test.com' });
    const uid = await liveUserId(db, 'u8');
    await markPseudonymous(db, uid);
    await seedSession(db, { id: 's8', userId: uid, expiresAt: now - grace - HOUR });
    const nowDate = new Date();
    await db.insert(account).values({
      id: 'acc-cred',
      userId: uid,
      accountId: uid,
      providerId: 'credential',
      password: 'hashed:argon2id:xxx',
      createdAt: nowDate,
      updatedAt: nowDate
    });

    expect(await selectReapableUsers(db, now, grace, 100)).toEqual([]);
  });

  it('selects a pseudonymous, non-durable user with no session rows at all', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u7', email: 'u7@test.com' });
    const uid = await liveUserId(db, 'u7');
    await markPseudonymous(db, uid);

    const rows = await selectReapableUsers(db, now, grace, 100);

    expect(rows).toEqual([{ liveUserId: uid, identityId: 'u7' }]);
  });

  it('excludes an already-tombstoned identity', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u6', email: 'u6@test.com' });
    const uid = await liveUserId(db, 'u6');
    await markPseudonymous(db, uid);
    await seedSession(db, { id: 's6', userId: uid, expiresAt: now - grace - HOUR });
    await db.update(userIdentity).set({ deletedAt: new Date() }).where(eq(userIdentity.id, 'u6'));

    expect(await selectReapableUsers(db, now, grace, 100)).toEqual([]);
  });
});
