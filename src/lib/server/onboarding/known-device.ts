import type { Cookies } from '@sveltejs/kit';

/** Bare unsigned flag: "a durable credential was used or created on this device."
 * Steers cold opens to /signin instead of silently minting a second account.
 * Never set on a pseudonymous mint (nothing to sign back into). */
export const KNOWN_DEVICE_COOKIE = 'sfh_known';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // browser cap

export function markKnownDevice(cookies: Cookies): void {
  cookies.set(KNOWN_DEVICE_COOKIE, '1', {
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: true
  });
}

export function isKnownDevice(cookies: Cookies): boolean {
  return cookies.get(KNOWN_DEVICE_COOKIE) === '1';
}
