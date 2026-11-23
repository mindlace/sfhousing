/**
 * Which requests resolve a Better-Auth session. A signed-out visitor to a public page
 * (no session cookie, no session route) never constructs Better-Auth and never gets a
 * cookie, so the public site behaves exactly as it did before sign-in existed. `/data/`
 * never resolves a session, even with a cookie: its responses are public and cached.
 */

/** Better-Auth's session cookie; over https it carries the `__Secure-` prefix. */
export const SESSION_COOKIE_SUFFIX = 'better-auth.session_token';

const SESSION_COOKIE_NAMES: ReadonlySet<string> = new Set([
  SESSION_COOKIE_SUFFIX,
  `__Secure-${SESSION_COOKIE_SUFFIX}`
]);

/** True when the Cookie header carries a session cookie under either name. */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((pair) => {
    const name = pair.split('=', 1)[0].trim();
    return SESSION_COOKIE_NAMES.has(name);
  });
}

/** Routes that read or set the session even for a visitor with no cookie yet. The
 *  forgot- and reset-password pages count as sign-in routes. */
const SESSION_ROUTE_PREFIXES = [
  '/api/auth',
  '/account',
  '/api/account',
  '/signin',
  '/forgot-password',
  '/reset-password',
  '/api/e2e',
  '/api/game'
] as const;

/** True for a path at or under one of the session route prefixes. */
export function routeNeedsSession(pathname: string): boolean {
  return SESSION_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The pathname as the router sees it: percent-decoded (`/%64ata/` routes to `/data/`).
 *  A path that does not decode is left as it is. */
function routedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/** Resolve the session for this request: never under `/data/` (decoded); otherwise when a
 *  session cookie is present or the route needs one. */
export function shouldResolveSession(url: URL, headers: Headers): boolean {
  if (routedPath(url.pathname).startsWith('/data/')) return false;
  return hasSessionCookie(headers.get('cookie')) || routeNeedsSession(url.pathname);
}
