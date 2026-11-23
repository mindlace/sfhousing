// e2e-only login: mints (or reuses) a registered user for `{ email }`, or mints a fresh
// pseudonymous account for `{ pseudonymous: true }`, and returns a signed session cookie.
// The VITE_E2E check comes first and is replaced at build time, so in a normal build only
// the 404 branch ships.
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { isE2eEnv } from '$lib/server/e2e/env';
import { getDb, type Database } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { issueTestSession, mintTestPseudonym, mintTestUser } from '$lib/server/e2e/session';

export const POST: RequestHandler = async ({ platform, request }) => {
  if (import.meta.env.VITE_E2E !== '1') return new Response(null, { status: 404 });
  if (!isE2eEnv(platform)) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const pseudonymous = fields.pseudonymous === true;
  const email = typeof fields.email === 'string' ? fields.email.trim() : '';
  if (!pseudonymous && !email) return new Response(null, { status: 400 });

  const env = platform!.env as unknown as { BETTER_AUTH_SECRET: string };
  const db = getDb(platform);
  const now = new Date();

  // A fresh pseudonymous account each time, as the anonymous plugin would make one; or the
  // live `user` row for this email (resolved or created), plus its stable identity. The
  // session FK references user.id; the stable identity is what the rest of the app keys off.
  const { userId, identityId } = pseudonymous
    ? await mintTestPseudonym(db, now)
    : await registeredUser(db, email, now);

  const cookie = await issueTestSession(db, env.BETTER_AUTH_SECRET, userId, now);

  // Return the stable identity id as `userId`: what e2e tests key off across sessions.
  const res = json({ userId: identityId });
  res.headers.append('set-cookie', cookie);
  return res;
};

async function registeredUser(
  db: Database,
  email: string,
  now: Date
): Promise<{ userId: string; identityId: string }> {
  const existing = await db
    .select({ userId: user.id, identityId: user.userIdentity })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (existing.length === 0) return mintTestUser(db, email, now);
  const { userId, identityId } = existing[0];
  await db.update(user).set({ updatedAt: now }).where(eq(user.id, userId));
  return { userId, identityId };
}
