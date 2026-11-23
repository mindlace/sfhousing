import type { Cookies } from '@sveltejs/kit';

/** Cookie that carries a typed-but-not-yet-submitted sign-in identifier into /signin, so
 *  the user does not retype it (WCAG 2.2 SC 3.3.7 Redundant Entry). /signin reads it and
 *  clears it; nothing writes it since the invite page went. Not a trust boundary: the identifier is the user's own input, it seeds a
 *  form field only, and authentication still requires a real factor. */
export const PENDING_IDENTIFIER_COOKIE = 'sfh_pending_identifier';

const MAX_AGE_SECONDS = 600; // 10 minutes

export function stashPendingIdentifier(cookies: Cookies, identifier: string): void {
  const value = identifier.trim();
  if (value.length === 0) return;
  cookies.set(PENDING_IDENTIFIER_COOKIE, value, {
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: true
  });
}

export function readPendingIdentifier(cookies: Cookies): string | null {
  const raw = cookies.get(PENDING_IDENTIFIER_COOKIE);
  const identifier = (raw ?? '').trim();
  return identifier.length > 0 ? identifier : null;
}

export function clearPendingIdentifier(cookies: Cookies): void {
  cookies.delete(PENDING_IDENTIFIER_COOKIE, { path: '/' });
}
