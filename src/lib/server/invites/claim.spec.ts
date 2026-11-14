import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { account, passkey, user } from '$lib/server/db/schema';
import { classifyColdAccept } from './claim';

async function liveUserId(
  db: ReturnType<typeof freshDb>['db'],
  identityId: string
): Promise<string> {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.userIdentity, identityId));
  return u.id;
}

describe('classifyColdAccept', () => {
  it('B: blank entered email, invited email present → mint, email-bound (not pseudonymous)', async () => {
    const { db } = freshDb();
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: '   '
    });
    expect(decision).toEqual({ kind: 'mint', pseudonymous: false });
  });

  it('handle invite (no invitedEmail), blank entered email → mint, pseudonymous', async () => {
    const { db } = freshDb();
    const decision = await classifyColdAccept({
      db,
      invitedEmail: null,
      enteredEmail: ''
    });
    expect(decision).toEqual({ kind: 'mint', pseudonymous: true });
  });

  it('B: blank entered email, invited email owns an account → signin (never a doomed mint)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u4', email: 'guest@test.com' });
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: ''
    });
    expect(decision).toEqual({ kind: 'signin', strongFactor: false, userId: 'u4' });
  });

  it('B: blank entered email, invited email owns a strong-factor account → signin, strongFactor true', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u5', email: 'guest@test.com' });
    const uid = await liveUserId(db, 'u5');
    const now = new Date();
    await db.insert(account).values({
      id: 'acc2',
      userId: uid,
      accountId: 'google-sub-2',
      providerId: 'google',
      createdAt: now,
      updatedAt: now
    });
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: ''
    });
    expect(decision).toEqual({ kind: 'signin', strongFactor: true, userId: 'u5' });
  });

  it('A1: entered === invited, no account → mint, email-bound (not pseudonymous)', async () => {
    const { db } = freshDb();
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: 'Guest@Test.com'
    });
    expect(decision).toEqual({ kind: 'mint', pseudonymous: false });
  });

  it('A2: entered === invited, magic-link-only account → signin, strongFactor false', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'guest@test.com' });
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: 'guest@test.com'
    });
    expect(decision).toEqual({ kind: 'signin', strongFactor: false, userId: 'u1' });
  });

  it('A3: entered === invited, OAuth account → signin, strongFactor true', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u2', email: 'guest@test.com' });
    const uid = await liveUserId(db, 'u2');
    const now = new Date();
    await db.insert(account).values({
      id: 'acc1',
      userId: uid,
      accountId: 'google-sub-1',
      providerId: 'google',
      createdAt: now,
      updatedAt: now
    });
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: 'guest@test.com'
    });
    expect(decision).toEqual({ kind: 'signin', strongFactor: true, userId: 'u2' });
  });

  it('A3: passkey credential also counts as a strong factor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u3', email: 'guest@test.com' });
    const uid = await liveUserId(db, 'u3');
    await db.insert(passkey).values({
      id: 'pk1',
      publicKey: 'pub',
      userId: uid,
      credentialID: 'cred-1',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false
    });
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: 'guest@test.com'
    });
    expect(decision).toEqual({ kind: 'signin', strongFactor: true, userId: 'u3' });
  });

  it('A2: signin resolves through a superseded identity to the survivor id', async () => {
    const { db } = freshDb();
    // The row carrying the invited email is a DEAD identity superseded by the survivor.
    await seedUser(db, { id: 'survivor', email: 'survivor@test.com', handle: 'survivor' });
    await seedUser(db, { id: 'dead', email: 'guest@test.com', handle: 'dead' });
    const { userIdentity } = await import('$lib/server/db/schema');
    await db
      .update(userIdentity)
      .set({ supersededById: 'survivor', supersededAt: new Date() })
      .where(eq(userIdentity.id, 'dead'));
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: 'guest@test.com'
    });
    // Resolved to the survivor id, not the dead one.
    expect(decision).toEqual({ kind: 'signin', strongFactor: false, userId: 'survivor' });
  });

  it('C: entered differs from invited → verify the new address', async () => {
    const { db } = freshDb();
    const decision = await classifyColdAccept({
      db,
      invitedEmail: 'guest@test.com',
      enteredEmail: 'other@test.com'
    });
    expect(decision).toEqual({ kind: 'verify', email: 'other@test.com' });
  });

  it('C: entered non-empty with a null invited email → verify', async () => {
    const { db } = freshDb();
    const decision = await classifyColdAccept({
      db,
      invitedEmail: null,
      enteredEmail: 'someone@test.com'
    });
    expect(decision).toEqual({ kind: 'verify', email: 'someone@test.com' });
  });
});
