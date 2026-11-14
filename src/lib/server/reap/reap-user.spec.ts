import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/user-store/deletion', () => ({ deleteAccount: vi.fn(async () => {}) }));

import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { session, user, userIdentity, passkey } from '$lib/server/db/schema';
import { deleteAccount } from '$lib/server/user-store/deletion';
import { reapUser, REAP_ACTOR } from './reap-user';

const HOUR = 3600_000;
const GRACE_MS = 48 * HOUR;
const NOW = 1_800_000_000_000;
const deleteAccountSpy = vi.mocked(deleteAccount);

async function liveUserId(db: ReturnType<typeof freshDb>['db'], identityId: string) {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.userIdentity, identityId));
  return u.id;
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

async function makeEligibleFixture(opts: { deleted?: boolean } = {}) {
  const { db } = freshDb();
  const identityId = 'reap-u1';
  await seedUser(db, { id: identityId, email: 'reap-u1@test.com' });
  const id = await liveUserId(db, identityId);
  await db.update(user).set({ isAnonymous: true }).where(eq(user.id, id));
  await seedSession(db, { id: 's1', userId: id, expiresAt: NOW - GRACE_MS - HOUR });
  if (opts.deleted) {
    await db
      .update(userIdentity)
      .set({ deletedAt: new Date() })
      .where(eq(userIdentity.id, identityId));
  }
  return { db, liveUserId: id, identityId, deleteAccountSpy };
}

async function addPasskey(db: ReturnType<typeof freshDb>['db'], liveId: string) {
  await db.insert(passkey).values({
    id: 'pk-reap',
    publicKey: 'pub-key-bytes',
    userId: liveId,
    credentialID: 'cred-reap',
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false
  });
}

describe('reapUser', () => {
  it('reaps an eligible pseudonymous user via deleteAccount', async () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW + HOUR);
    const { db, liveUserId: uid, identityId } = await makeEligibleFixture();
    deleteAccountSpy.mockClear();

    const res = await reapUser(db, uid);

    expect(res).toEqual({ reaped: true });
    expect(deleteAccountSpy).toHaveBeenCalledWith(
      expect.objectContaining({ identityId, actor: REAP_ACTOR })
    );
    dateSpy.mockRestore();
  });

  it.each([
    [
      'the user became durable between dispatch and execution',
      async () => {
        const { db, liveUserId: uid } = await makeEligibleFixture();
        await addPasskey(db, uid);
        return { db, uid };
      }
    ],
    [
      'the identity is already tombstoned',
      async () => {
        const { db, liveUserId: uid } = await makeEligibleFixture({ deleted: true });
        return { db, uid };
      }
    ]
  ])('is a no-op when %s', async (_case, setup) => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW + HOUR);
    const { db, uid } = await setup();
    deleteAccountSpy.mockClear();

    const res = await reapUser(db, uid);

    expect(res).toEqual({ reaped: false });
    expect(deleteAccountSpy).not.toHaveBeenCalled();
    dateSpy.mockRestore();
  });
});
