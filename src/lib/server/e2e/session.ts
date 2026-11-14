import { serializeSignedCookie } from 'better-call';
import type { Database } from '$lib/server/db';
import { newId } from '$lib/server/ids/factory';
import { principal, userIdentity, user, session } from '$lib/server/db/schema';
import { skeleton } from '$lib/server/user-store/confusable-skeleton';

// Session-cookie machinery for the e2e-only login seam (/api/e2e/login).
export const SESSION_COOKIE_NAME = 'better-auth.session_token';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Better-Auth auto-enables secure cookies when its baseURL is https, which
// prefixes the session cookie name with `__Secure-`. A synthetic session must
// match that name or `auth.api.getSession` won't find it. Pass `secure` =
// whether the request is https so the name matches the live config.
export function sessionCookieName(secure: boolean): string {
  return secure ? `__Secure-${SESSION_COOKIE_NAME}` : SESSION_COOKIE_NAME;
}

/** Mint a fresh REGISTERED live `user` row + its own stable identity, mirroring
 *  databaseHooks.user.create. Returns both ids (`userId` is the live `user.id`). */
export async function mintTestUser(
  db: Database,
  email: string,
  now: Date
): Promise<{ userId: string; identityId: string }> {
  const identityId = newId();
  const userId = newId();
  await db.insert(principal).values({ id: identityId, kind: 'identity' });
  await db.insert(userIdentity).values({ id: identityId, createdAt: now });
  await db.insert(user).values({
    id: userId,
    name: email,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    userIdentity: identityId,
    handle: email.split('@')[0],
    handleSkeleton: skeleton(email.split('@')[0])
  });
  return { userId, identityId };
}

/** Insert a session row for the given live `user` id and return a signed cookie.
 *  `secure` (default false for the local http e2e endpoint) selects the
 *  `__Secure-` cookie name + attribute so the cookie is recognized over https. */
export async function issueTestSession(
  db: Database,
  secret: string,
  userId: string,
  now: Date,
  secure = false
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(session).values({
    id: crypto.randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now
  });
  return serializeSignedCookie(sessionCookieName(secure), token, secret, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}
