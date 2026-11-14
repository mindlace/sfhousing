import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getAuth } from '$lib/server/auth/better-auth';
import { shouldResolveSession } from '$lib/server/auth/session-gate';
import { getDb } from '$lib/server/db';
import { resolveSessionUser } from '$lib/server/user-store/user';
import { resolveCapabilities } from '$lib/server/operator/capabilities';

function setPublicLocals(locals: App.Locals) {
  locals.user = null;
  locals.session = null;
  locals.capabilities = [];
  locals.actorKind = 'public';
}

/**
 * Resolves the Better-Auth session into `locals`, only when a session cookie is present or
 * the route needs a session (`shouldResolveSession`). Every other request, and everything
 * under `/data/`, gets the public locals without Better-Auth being constructed, so a
 * signed-out visitor gets no cookie and a missing `BETTER_AUTH_SECRET` breaks only the
 * auth routes.
 */
export const sessionHandle: Handle = async ({ event, resolve }) => {
  if (!shouldResolveSession(event.url, event.request.headers)) {
    setPublicLocals(event.locals);
    return resolve(event);
  }
  const auth = getAuth(event.platform!, event.url.origin);
  // A WebSocket upgrade returns a 101 whose headers are immutable in the Workers
  // runtime. Better-Auth's rolling-session refresh would stage a `set-cookie` that
  // SvelteKit then folds in via `add_cookies_to_headers`, throwing "Can't modify
  // immutable headers". `disableRefresh` reads the session WITHOUT that write, so no
  // cookie is staged; the session still resolves, and the next ordinary HTTP request
  // refreshes it. Keyed on the request's own `upgrade` header (not route id): this is
  // about the 101 response shape, and disableRefresh is harmless on any request.
  const isWsUpgrade = event.request.headers.get('upgrade')?.toLowerCase() === 'websocket';
  const session = await auth.api.getSession({
    headers: event.request.headers,
    ...(isWsUpgrade ? { query: { disableRefresh: true } } : {})
  });
  if (session?.user) {
    const db = getDb(event.platform!);
    const u = await resolveSessionUser(db, session.user.id);
    event.locals.user = u; // the seam's User IS the locals.user shape
    // `locals.session.userId` is the LIVE Better-Auth `user.id` — the FK target of
    // `account`/`passkey`/`session`. It is deliberately NOT `u.id` (the stable
    // `user_identity.id` on `locals.user`): the two are distinct id spaces, so keying
    // the live tables off the identity id misses every row.
    event.locals.session = session.session
      ? { id: session.session.id, userId: session.session.userId }
      : null;
    // Operator capabilities: a verified BOOTSTRAP_EMAILS address gets the app wildcard with no
    // read; anyone else gets the ledger fold (one capability_event read, plus the identity
    // chain reads). Runs only here, on a request that already resolved a session user.
    // BOOTSTRAP_EMAILS is a secret, not a wrangler var, so it is not in `Env`.
    const { BOOTSTRAP_EMAILS } = event.platform!.env as { BOOTSTRAP_EMAILS?: string };
    event.locals.capabilities = u ? await resolveCapabilities(db, u, BOOTSTRAP_EMAILS) : [];
    // A tombstoned identity survives `getSession` but `resolveSessionUser` returns
    // null; treat that as anonymous ('public'), not 'human'.
    event.locals.actorKind = u ? 'human' : 'public';
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
