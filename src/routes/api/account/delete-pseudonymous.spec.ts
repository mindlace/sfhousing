// DELETE /api/account for a pseudonymous account, the deletion path that runs most in
// production, against a real migrated database and the real deleteAccount.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { session, user, userIdentity } from '$lib/server/db/schema';
import { freshDb, seedUser } from '$lib/server/test/auth-db';

const { holder, signOut } = vi.hoisted(() => ({
  holder: { db: undefined as unknown },
  signOut: vi.fn(async () => {})
}));
vi.mock('$lib/server/db', () => ({ getDb: () => holder.db }));
vi.mock('$lib/server/auth/better-auth', () => ({ authFor: () => ({ api: { signOut } }) }));

import { DELETE } from './+server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  vi.clearAllMocks();
});

async function setup() {
  const t = freshDb();
  opened.push(t.close);
  holder.db = t.db;
  await seedUser(t.db, { id: 'p1', email: 'p1@pseudonymous.invalid', handle: 'wandering-wren' });
  await t.db.update(user).set({ isAnonymous: true }).where(eq(user.id, 'p1-live'));
  const now = new Date();
  await t.db.insert(session).values({
    id: 's1',
    userId: 'p1-live',
    token: 't1',
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now
  });
  return t;
}

function call(confirmHandle: string) {
  return DELETE({
    locals: {
      user: { id: 'p1', handle: 'wandering-wren', pseudonymous: true },
      session: { id: 's1', userId: 'p1-live' }
    },
    platform: {},
    url: new URL('http://localhost/api/account'),
    request: new Request('http://localhost/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmHandle })
    })
  } as never);
}

describe('DELETE /api/account for a pseudonymous account', () => {
  it('marks the identity deleted, removes the session and releases the handle in one 200', async () => {
    const { db } = await setup();

    const res = await call('wandering-wren');
    expect(res.status).toBe(200);

    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'p1'));
    expect(idRow.deletedAt).not.toBeNull();
    expect(await db.select().from(session).where(eq(session.userId, 'p1-live'))).toHaveLength(0);
    const [live] = await db.select().from(user).where(eq(user.userIdentity, 'p1'));
    expect(live.handle).not.toBe('wandering-wren');
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('deletes nothing on a handle mismatch', async () => {
    const { db } = await setup();
    const res = await call('someone-else');
    expect(res.status).toBe(400);
    const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, 'p1'));
    expect(idRow.deletedAt).toBeNull();
    expect(await db.select().from(session).where(eq(session.userId, 'p1-live'))).toHaveLength(1);
  });
});
