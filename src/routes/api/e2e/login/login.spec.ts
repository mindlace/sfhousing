import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, makePlatform } from '$lib/server/test/auth-db';
import { session, user } from '$lib/server/db/schema';
import { POST } from './+server';

const ENV = { ENVIRONMENT: 'development', BETTER_AUTH_SECRET: 'a'.repeat(40) };

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/e2e/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function event(platform: App.Platform, request: Request) {
  return { platform, request } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.stubEnv('VITE_E2E', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/e2e/login', () => {
  it('404 outside an e2e build', async () => {
    vi.stubEnv('VITE_E2E', '');
    const { shim } = freshDb();
    const res = await POST(event(makePlatform(shim, ENV), makeRequest({ email: 'a@b.com' })));
    expect(res.status).toBe(404);
  });

  it('404 in an e2e build outside development', async () => {
    const { shim } = freshDb();
    const platform = makePlatform(shim, { ...ENV, ENVIRONMENT: 'production' });
    const res = await POST(event(platform, makeRequest({ email: 'a@b.com' })));
    expect(res.status).toBe(404);
  });

  it('400 when body has no email', async () => {
    const { shim } = freshDb();
    const res = await POST(event(makePlatform(shim, ENV), makeRequest({})));
    expect(res.status).toBe(400);
  });

  it('400 when the body is not JSON', async () => {
    const { shim } = freshDb();
    const res = await POST(event(makePlatform(shim, ENV), makeRequest('not json')));
    expect(res.status).toBe(400);
  });

  it('200 with Set-Cookie better-auth.session_token=... in an e2e build', async () => {
    const { shim } = freshDb();
    const res = await POST(
      event(makePlatform(shim, ENV), makeRequest({ email: 'alice@test.com' }))
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie!).toMatch(/^better-auth\.session_token=/);
  });

  it('{ pseudonymous: true } mints an anonymous account, sets the session cookie and answers its identity id', async () => {
    const { db, shim } = freshDb();
    const res = await POST(event(makePlatform(shim, ENV), makeRequest({ pseudonymous: true })));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')!).toMatch(/^better-auth\.session_token=/);
    const body = (await res.json()) as { userId: string };
    const [row] = await db.select().from(user).where(eq(user.userIdentity, body.userId));
    expect(row.isAnonymous).toBe(true);
    expect(row.userIdentity).toBe(body.userId);
    const sessions = await db.select().from(session).where(eq(session.userId, row.id));
    expect(sessions.length).toBe(1);
  });

  it('{ pseudonymous: false } with no email answers 400', async () => {
    const { db, shim } = freshDb();
    const res = await POST(event(makePlatform(shim, ENV), makeRequest({ pseudonymous: false })));
    expect(res.status).toBe(400);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it('upserts user: same email twice returns same userId (stable identity id)', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim, ENV);
    const res1 = await POST(event(platform, makeRequest({ email: 'bob@test.com' })));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { userId: string };

    const res2 = await POST(event(platform, makeRequest({ email: 'bob@test.com' })));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { userId: string };

    expect(body1.userId).toBe(body2.userId);

    // Only one live user row for this email (no duplicate minting).
    const rows = await db.select().from(user).where(eq(user.email, 'bob@test.com'));
    expect(rows.length).toBe(1);
    expect(rows[0].userIdentity).toBe(body1.userId);
  });
});
