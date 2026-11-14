/**
 * Breach check for a password being SET on an already-signed-in session.
 *
 * Why this exists rather than leaning on Better-Auth's `haveIBeenPwned()` plugin:
 * the plugin hooks `ctx.password.hash` and only runs the check when the current
 * endpoint's path is in its `paths` allowlist:
 *
 *   if (!c.path || !paths.includes(c.path)) return originalHash(password);
 *
 * `auth.api.setPassword` is declared with `createAuthEndpoint.serverOnly(...)`,
 * which takes NO path at all ("It takes no path because it has no URL to be
 * reached at" — @better-auth/core/dist/api/index.mjs). So `c.path` is undefined,
 * the guard short-circuits, and the plugin can never fire for a set-password
 * call — and no `paths` config can fix that, because there is no path to list.
 * The plugin still covers `/change-password` and `/reset-password`, which do
 * have paths; this module covers the one flow it structurally cannot reach.
 *
 * Uses the same k-anonymity range API the plugin uses: only the first 5 hex
 * characters of the SHA-1 leave this worker, so the password itself is never
 * sent anywhere.
 */

const RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/';

/**
 * Cloudflare gives no dependable client-side subrequest timeout, so a SLOW
 * range API would stall the user's request rather than failing open. An
 * explicit abort turns "hanging" into "erroring", which the catch below
 * already converts into the fail-open path.
 */
const RANGE_TIMEOUT_MS = 2000;

async function sha1Hex(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Has this password appeared in a known breach corpus?
 *
 * Fails OPEN (returns false) when the range API is unreachable or errors. A
 * third-party outage must not block a pseudonymous user from making their
 * account durable — the failure mode we are guarding against here is a weak
 * password, and refusing every password during an outage trades a small risk
 * for a total loss of the feature. The miss is logged so it stays visible.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  if (!password) return false;
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`${RANGE_ENDPOINT}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'SFHousing-PasswordChecker' },
      signal: AbortSignal.timeout(RANGE_TIMEOUT_MS)
    });
    if (!res.ok) {
      console.warn(`[password-breach] range API returned ${res.status} — allowing (fail open)`);
      return false;
    }
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.split(':');
      if (hashSuffix?.trim().toUpperCase() !== suffix) return false;
      // We ask for padding, so the response carries synthetic entries whose
      // count is 0. Canonical guidance is to ignore them — treating one as a
      // hit would reject a password that is not in the corpus at all.
      return Number(count?.trim()) > 0;
    });
  } catch (err) {
    console.warn(
      `[password-breach] range API unreachable — allowing (fail open): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}
