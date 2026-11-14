import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb } from '$lib/server/test/auth-db';
import { userIdentity, user, session } from '$lib/server/db/schema';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieName,
  mintTestUser,
  issueTestSession
} from './session';
import { resolveSessionUser } from '$lib/server/user-store/user';

describe('mintTestUser', () => {
  it('creates a stable identity + a registered live user row', async () => {
    const { db } = freshDb();
    const now = new Date();
    const { userId, identityId } = await mintTestUser(db, 'alice@test.com', now);

    expect(userId).toBeTruthy();
    expect(identityId).toBeTruthy();
    expect(userId).not.toBe(identityId);

    const [identity] = await db.select().from(userIdentity).where(eq(userIdentity.id, identityId));
    expect(identity).toBeTruthy();

    const [liveUser] = await db.select().from(user).where(eq(user.id, userId));
    expect(liveUser.email).toBe('alice@test.com');
    expect(liveUser.handle).toBe('alice');
    expect(liveUser.userIdentity).toBe(identityId);
    expect(liveUser.emailVerified).toBe(true);
  });

  it('mints a fresh identity + live user on each call (no upsert)', async () => {
    const { db } = freshDb();
    const now = new Date();
    // Distinct emails: handle has a UNIQUE constraint, and the helper deliberately
    // does NOT dedupe — each call is an unconditional insert.
    const a = await mintTestUser(db, 'first@test.com', now);
    const b = await mintTestUser(db, 'second@test.com', now);

    expect(a.identityId).not.toBe(b.identityId);
    expect(a.userId).not.toBe(b.userId);
    const rows = await db.select().from(user);
    expect(rows.length).toBe(2);
  });
});

describe('issueTestSession', () => {
  it('inserts a session row and returns a signed cookie for the live user id', async () => {
    const { db } = freshDb();
    const now = new Date();
    const { userId } = await mintTestUser(db, 'bob@test.com', now);

    const cookie = await issueTestSession(db, 'a'.repeat(40), userId, now);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME.replace('.', '\\.')}=`));
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);

    const rows = await db.select().from(session).where(eq(session.userId, userId));
    expect(rows.length).toBe(1);
    expect(rows[0].token).toBeTruthy();
    // expiresAt is persisted at second precision (Unix-seconds column).
    const expectedSeconds = Math.floor((now.getTime() + SESSION_MAX_AGE_SECONDS * 1000) / 1000);
    expect(Math.floor(rows[0].expiresAt.getTime() / 1000)).toBe(expectedSeconds);
  });

  it('uses the __Secure- cookie name + Secure attribute when secure=true', async () => {
    const { db } = freshDb();
    const now = new Date();
    const { userId } = await mintTestUser(db, 'dave@test.com', now);

    const cookie = await issueTestSession(db, 'a'.repeat(40), userId, now, true);
    // Better-Auth reads `__Secure-better-auth.session_token` over https; the
    // synthetic cookie must match or getSession won't find it.
    expect(cookie).toMatch(new RegExp(`^__Secure-${SESSION_COOKIE_NAME.replace('.', '\\.')}=`));
    expect(cookie).toContain('Secure');
    expect(sessionCookieName(true)).toBe(`__Secure-${SESSION_COOKIE_NAME}`);
    expect(sessionCookieName(false)).toBe(SESSION_COOKIE_NAME);
  });

  it('session minted for userId resolves to the identity via resolveSessionUser', async () => {
    const { db } = freshDb();
    const now = new Date();
    const { userId, identityId } = await mintTestUser(db, 'carol@test.com', now);
    await issueTestSession(db, 'a'.repeat(40), userId, now);

    const resolved = await resolveSessionUser(db, userId);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(identityId);
    expect(resolved!.email).toBe('carol@test.com');
  });
});
