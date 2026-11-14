import type { Cookies } from '@sveltejs/kit';

/** Cookie that carries a typed-but-not-yet-saved sim title across the sign-in hop.
 *  Not a trust boundary: the title is the user's own input and creation still requires auth. */
export const PENDING_SIM_COOKIE = 'sfh_pending_sim';

const MAX_AGE_SECONDS = 600; // 10 minutes — long enough to finish sign-in, short enough not to linger

export function stashPendingSim(cookies: Cookies, title: string): void {
  cookies.set(PENDING_SIM_COOKIE, title.trim(), {
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: true
  });
}

export function readPendingSim(cookies: Cookies): string | null {
  const raw = cookies.get(PENDING_SIM_COOKIE);
  const title = (raw ?? '').trim();
  return title.length > 0 ? title : null;
}

export function clearPendingSim(cookies: Cookies): void {
  cookies.delete(PENDING_SIM_COOKIE, { path: '/' });
}
