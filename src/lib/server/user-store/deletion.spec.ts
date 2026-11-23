import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedIdentity, seedUser } from '$lib/server/test/auth-db';
import type { Database } from '$lib/server/db';
import { putGame, removeGame } from '$lib/server/game/store';
import { parseGameSave, type GameSave } from '$lib/game/saves';
import { newId } from '$lib/ids/base58';
import { deleteAccount } from './deletion';
import {
  user,
  userIdentity,
  userVersion,
  session,
  account,
  passkey,
  handleTombstone,
  gameSave
} from '$lib/server/db/schema';
import { recordUserVersion } from './history';
import { sha256Hex } from '$lib/sharing/hash';
import { skeleton } from './confusable-skeleton';
import {
  deletedHandle,
  deletedEmail,
  releaseHandle,
  scrubLiveUser,
  hashPriorVersions,
  purgeCredentialsAndSettings,
  markIdentityDeleted
} from './deletion';

const NOW = new Date('2026-06-15T00:00:00Z');

function gameOf(): GameSave {
  const s: GameSave = {
    v: 1,
    id: newId(),
    name: 'Game, 22 Nov',
    nameIsDefault: true,
    progress: { v: 1, level: 2, banked: {}, firstWinAt: '2026-11-22T10:00:00.000Z' },
    plan: null,
    policy: null,
    savedAt: '2026-11-22T12:00:00.000Z'
  };
  if (!parseGameSave(s)) throw new Error('test save is not valid');
  return s;
}

/** One session, one account and one passkey row for the live user `liveId`. */
async function seedCredentials(db: Database, liveId: string, tag: string): Promise<void> {
  await db.insert(session).values({
    id: `s-${tag}`,
    userId: liveId,
    token: `t-${tag}`,
    expiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW
  });
  await db.insert(account).values({
    id: `a-${tag}`,
    userId: liveId,
    accountId: `g-${tag}`,
    providerId: 'google',
    createdAt: NOW,
    updatedAt: NOW
  });
  await db.insert(passkey).values({
    id: `p-${tag}`,
    userId: liveId,
    publicKey: 'k',
    credentialID: `c-${tag}`,
    counter: 0,
    deviceType: 'platform',
    backedUp: false
  });
}

describe('scrubLiveUser', () => {
  test('replaces handle/email/name/image with placeholders', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', name: 'Alice', handle: 'alice' });
    await scrubLiveUser(db, 'id1', 'id1-live', NOW);
    const [u] = await db.select().from(user).where(eq(user.id, 'id1-live'));
    expect(u.handle).toBe(deletedHandle('id1'));
    expect(u.handleSkeleton).toBe(skeleton(deletedHandle('id1')));
    expect(u.email).toBe(deletedEmail('id1'));
    expect(u.name).toBe('Deleted User');
    expect(u.image).toBeNull();
  });
});

describe('releaseHandle', () => {
  test('tombstones the old handle, idempotent on conflict', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await releaseHandle(db, 'id1', 'alice', NOW);
    await releaseHandle(db, 'id1', 'alice', NOW); // no throw
    const rows = await db.select().from(handleTombstone).where(eq(handleTombstone.handle, 'alice'));
    expect(rows).toHaveLength(1);
    expect(rows[0].releasedBy).toBe('id1');
  });
});

describe('hashPriorVersions', () => {
  test('hashes email + name, keeps handle, skips placeholder + already-hashed rows', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await recordUserVersion({
      db,
      identityId: 'id1',
      handle: 'alice',
      name: 'Alice',
      email: 'a@x.com'
    });
    await recordUserVersion({
      db,
      identityId: 'id1',
      handle: deletedHandle('id1'),
      name: 'Deleted User',
      email: deletedEmail('id1')
    });

    await hashPriorVersions(db, ['id1']);

    const rows = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    const real = rows.find((r) => r.handle === 'alice')!;
    expect(real.handle).toBe('alice');
    expect(real.email).toBe(await sha256Hex('a@x.com'));
    // name is normalized: trim + lowercase before hashing — 'Alice' → sha256('alice')
    expect(real.name).toBe(await sha256Hex('Alice'.trim().toLowerCase()));
    const tomb = rows.find((r) => r.email === deletedEmail('id1'))!;
    expect(tomb.name).toBe('Deleted User');

    await hashPriorVersions(db, ['id1']);
    const after = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(after.find((r) => r.handle === 'alice')!.email).toBe(await sha256Hex('a@x.com'));
  });
});

describe('purgeCredentialsAndSettings', () => {
  test('purgeCredentialsAndSettings deletes the session, account and passkey rows of the live user', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await seedUser(db, { id: 'id2', email: 'bob@x.com', handle: 'bob' });
    await seedCredentials(db, 'id1-live', 'one');
    await seedCredentials(db, 'id2-live', 'two');

    await purgeCredentialsAndSettings(db, 'id1-live');

    expect(await db.select().from(session).where(eq(session.userId, 'id1-live'))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, 'id1-live'))).toHaveLength(0);
    expect(await db.select().from(passkey).where(eq(passkey.userId, 'id1-live'))).toHaveLength(0);
    expect(await db.select().from(session)).toHaveLength(1);
    expect(await db.select().from(account)).toHaveLength(1);
    expect(await db.select().from(passkey)).toHaveLength(1);
  });
});

describe('markIdentityDeleted', () => {
  test('sets deleted_at', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'a@x.com', handle: 'alice' });
    await markIdentityDeleted(db, 'id1', NOW);
    const [row] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(row.deletedAt).toEqual(NOW);
  });
});

describe('deleteAccount', () => {
  test('deleteAccount scrubs, tombstones and purges in one call and answers more: false', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', name: 'Alice', handle: 'alice' });
    await seedCredentials(db, 'id1-live', 'one');

    expect(await deleteAccount({ db, identityId: 'id1' })).toEqual({ more: false });

    const [u] = await db.select().from(user).where(eq(user.userIdentity, 'id1'));
    expect(u.email).toBe(deletedEmail('id1'));
    const tomb = await db.select().from(handleTombstone).where(eq(handleTombstone.handle, 'alice'));
    expect(tomb).toHaveLength(1);
    expect(await db.select().from(session)).toHaveLength(0);
    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(idRow.deletedAt).not.toBeNull();
  });

  test('a second deleteAccount is a no-op that answers more: false', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    await deleteAccount({ db, identityId: 'id1' });
    const before = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(await deleteAccount({ db, identityId: 'id1' })).toEqual({ more: false });
    const after = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(after).toHaveLength(before.length);
  });

  test('an unknown identity answers more: false and writes nothing', async () => {
    const { db } = freshDb();
    expect(await deleteAccount({ db, identityId: 'nobody' })).toEqual({ more: false });
    expect(await db.select().from(userIdentity)).toHaveLength(0);
    expect(await db.select().from(userVersion)).toHaveLength(0);
    expect(await db.select().from(handleTombstone)).toHaveLength(0);
  });

  test('deletes the saved games of the account and of identities fused into it', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'surv', email: 'surv@x.com', handle: 'surv' });
    await seedIdentity(db, { id: 'fused', supersededById: 'surv' });
    await seedUser(db, { id: 'keep', email: 'keep@x.com', handle: 'keep' });
    const live = gameOf();
    const removed = gameOf();
    const fusedGame = gameOf();
    const kept = gameOf();
    await putGame(db, 'surv', live, null);
    await putGame(db, 'surv', removed, null);
    await removeGame(db, 'surv', removed.id, NOW);
    await putGame(db, 'fused', fusedGame, null);
    await putGame(db, 'keep', kept, null);

    await deleteAccount({ db, identityId: 'surv' });

    const left = await db.select().from(gameSave);
    expect(left.map((r) => [r.identityId, r.id])).toEqual([['keep', kept.id]]);
  });

  test('erases PII for an identity fused into the survivor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'surv', email: 'surv@x.com', name: 'Survivor', handle: 'surv' });
    await seedUser(db, { id: 'fused', email: 'fused@x.com', name: 'Fused', handle: 'fused' });
    // Fuse `fused` into `surv`.
    await db
      .update(userIdentity)
      .set({ supersededById: 'surv', supersededAt: NOW })
      .where(eq(userIdentity.id, 'fused'));
    await recordUserVersion({
      db,
      identityId: 'fused',
      handle: 'fused',
      name: 'Fused',
      email: 'fused@x.com'
    });

    await deleteAccount({ db, identityId: 'surv' });

    // Fused-in identity's prior-version email is now hashed.
    const fusedVersions = await db
      .select()
      .from(userVersion)
      .where(eq(userVersion.userIdentity, 'fused'));
    expect(fusedVersions.find((r) => r.handle === 'fused')!.email).toBe(
      await sha256Hex('fused@x.com')
    );
    // Survivor tombstoned.
    const [survRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'surv'));
    expect(survRow.deletedAt).not.toBeNull();
  });

  test('releases the handle, hashes prior versions and drops credentials', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', name: 'Alice', handle: 'alice' });
    await recordUserVersion({
      db,
      identityId: 'id1',
      handle: 'alice',
      name: 'Alice',
      email: 'alice@x.com'
    });
    await db.insert(session).values({
      id: 's1',
      userId: 'id1-live',
      token: 't1',
      expiresAt: NOW,
      createdAt: NOW,
      updatedAt: NOW
    });

    await deleteAccount({ db, identityId: 'id1' });

    const tomb = await db.select().from(handleTombstone).where(eq(handleTombstone.handle, 'alice'));
    expect(tomb).toHaveLength(1);
    expect(await db.select().from(session)).toHaveLength(0);
    const versions = await db.select().from(userVersion).where(eq(userVersion.userIdentity, 'id1'));
    expect(versions.find((r) => r.handle === 'alice')!.email).toBe(await sha256Hex('alice@x.com'));
  });

  test('marks the identity deleted last: a failure in a prior step leaves it live', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'alice@x.com', handle: 'alice' });
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'delete') {
          return () => {
            throw new Error('boom');
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    }) as typeof db;

    await expect(deleteAccount({ db: failing, identityId: 'id1' })).rejects.toThrow('boom');

    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'id1'));
    expect(idRow.deletedAt).toBeNull();
  });
});
