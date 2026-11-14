// e2e-only login: mints (or reuses) a registered user for an email and returns a signed
// session cookie. The VITE_E2E check comes first and is replaced at build time, so in a
// normal build only the 404 branch ships.
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { isE2eEnv } from '$lib/server/e2e/env';
import { getDb } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { issueTestSession, mintTestUser } from '$lib/server/e2e/session';

export const POST: RequestHandler = async ({ platform, request }) => {
  if (import.meta.env.VITE_E2E !== '1') return new Response(null, { status: 404 });
  if (!isE2eEnv(platform)) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const email =
    body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string'
      ? (body as { email: string }).email.trim()
      : '';
  if (!email) return new Response(null, { status: 400 });

  const env = platform!.env as unknown as { BETTER_AUTH_SECRET: string };
  const db = getDb(platform);
  const now = new Date();

  // Resolve (or create) the live `user` row for this email, plus its stable identity.
  // The session FK references user.id; the stable identity is what the rest of the app
  // keys off.
  const existing = await db
    .select({ userId: user.id, identityId: user.userIdentity })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  let userId: string;
  let identityId: string;
  if (existing.length > 0) {
    userId = existing[0].userId;
    identityId = existing[0].identityId;
    await db.update(user).set({ updatedAt: now }).where(eq(user.id, userId));
  } else {
    ({ userId, identityId } = await mintTestUser(db, email, now));
  }

  const cookie = await issueTestSession(db, env.BETTER_AUTH_SECRET, userId, now);

  // Return the stable identity id as `userId`: what e2e tests key off across sessions.
  const res = json({ userId: identityId });
  res.headers.append('set-cookie', cookie);
  return res;
};
