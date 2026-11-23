import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getAuth } from '$lib/server/auth/better-auth';
import { shouldResolveSession } from '$lib/server/auth/session-gate';
import { getDb } from '$lib/server/db';
import { resolveSessionUser } from '$lib/server/user-store/user';

function setPublicLocals(locals: App.Locals) {
  locals.user = null;
  locals.session = null;
}

/**
 * Resolves the Better-Auth session into `locals`, only when a session cookie is present or
 * the route needs a session (`shouldResolveSession`). Every other request, and everything
 * under `/data/`, gets the public locals without Better-Auth being constructed, so a
 * signed-out visitor gets no cookie. A missing `BETTER_AUTH_SECRET` therefore spares a
 * signed-out visitor's public pages but fails every request that resolves a session: any
 * request with a session cookie, and every session route.
 */
export const sessionHandle: Handle = async ({ event, resolve }) => {
  if (!shouldResolveSession(event.url, event.request.headers)) {
    setPublicLocals(event.locals);
    return resolve(event);
  }
  const auth = getAuth(event.platform!, event.url.origin);
  const session = await auth.api.getSession({ headers: event.request.headers });
  // A tombstoned identity survives `getSession` but `resolveSessionUser` returns null:
  // that request gets the public locals, session included.
  const u = session?.user
    ? await resolveSessionUser(getDb(event.platform!), session.user.id)
    : null;
  if (session && u) {
    event.locals.user = u; // the seam's User IS the locals.user shape
    // `locals.session.userId` is the LIVE Better-Auth `user.id` — the FK target of
    // `account`/`passkey`/`session`. It is deliberately NOT `u.id` (the stable
    // `user_identity.id` on `locals.user`): the two are distinct id spaces, so keying
    // the live tables off the identity id misses every row.
    event.locals.session = session.session
      ? { id: session.session.id, userId: session.session.userId }
      : null;
  } else {
    setPublicLocals(event.locals);
  }
  return resolve(event);
};

function setDefaultHeaders(response: Response) {
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-content-type-options', 'nosniff');
  // adapter-cloudflare's worker puts any cacheable GET into caches.default, so HTML with no
  // explicit cache-control would outlive a deploy and reference dead asset hashes.
  if (
    response.headers.get('content-type')?.startsWith('text/html') &&
    !response.headers.has('cache-control')
  ) {
    response.headers.set('cache-control', 'private, no-cache');
  }
}

export const headersHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  // A WebSocket upgrade's 101 has immutable headers and carries no document to protect.
  if (response.status === 101) return response;
  try {
    setDefaultHeaders(response);
    return response;
  } catch {
    // Immutable headers (e.g. redirects, fetched responses): re-wrap to get mutable ones.
    const wrapped = new Response(response.body, response);
    setDefaultHeaders(wrapped);
    return wrapped;
  }
};

export const handle: Handle = sequence(sessionHandle, headersHandle);
