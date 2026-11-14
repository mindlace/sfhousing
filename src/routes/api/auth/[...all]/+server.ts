import type { RequestHandler } from './$types';
import { authFor } from '$lib/server/auth/better-auth';
import { enabledAuthMethods, methodForAuthPath } from '$lib/server/auth/methods';
import { enforceRate } from '$lib/server/security/rate-limit';

/**
 * Brute-force / abuse controls for the RAW Better-Auth endpoints.
 *
 * Why here and NOT via `betterAuth({ rateLimit: { customRules } })`: Better-Auth's limiter
 * defaults to the `memory` storage backend — a module-global `Map`. On Workers that Map is
 * per-isolate and evicted at will, so an attacker spreading requests across isolates (the
 * normal case at the edge) would face no shared counter at all. A `customRules` entry would
 * LOOK like protection while enforcing close to nothing. Cloudflare's native rate-limit
 * bindings are the only backend here with a real distributed counter, and `enforceRate` is
 * the seam that owns them (fail-closed in production, inert in development). So the limits
 * live in the route, in front of `auth.handler`.
 */

/** `POST /api/auth/sign-in/email` — the raw twin of the `/signin` `signInPassword` action. */
const SIGN_IN_EMAIL = '/api/auth/sign-in/email';
/** `POST /api/auth/request-password-reset`; there is NO `/forget-password` alias. */
const REQUEST_PASSWORD_RESET = '/api/auth/request-password-reset';
/**
 * `POST /api/auth/reset-password` — the submit half. Unlike the two paths above it
 * carries no email (the body is `{ token, newPassword }`), so only the per-IP
 * dimension applies. The 24-char token makes guessing impractical, but an
 * unlimited auth-mutating endpoint should not stand.
 */
const RESET_PASSWORD = '/api/auth/reset-password';

const notFound = () => new Response('Not found', { status: 404 });
const tooMany = () =>
  new Response(JSON.stringify({ message: 'Too many requests' }), {
    status: 429,
    headers: { 'content-type': 'application/json' }
  });

/** Best-effort read of the `email` field from a JSON body, on a CLONE so the original
 *  request body stays intact for Better-Auth. A malformed/absent body simply yields
 *  undefined — the per-IP dimension still applies. */
async function readEmail(request: Request): Promise<string | undefined> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    return email || undefined;
  } catch {
    return undefined;
  }
}

// Delegate every auth route to Better-Auth EXCEPT a switched-off sign-in method's paths and
// the public pseudonymous sign-in faucet. Better-Auth's own configuration is not a sufficient
// gate for a switched-off method: `/reset-password`, `/change-password` and
// `/verify-password` check no configuration, so the path gate closes them here.
// Pseudonymous identities are minted ONLY in-process, behind PSEUDO_MINT_RL. The public
// HTTP route would let a script mint identities directly, bypassing that rate limit
// entirely, so close it outright. 404 (not 403) avoids advertising that the endpoint exists.
const handler: RequestHandler = async (event) => {
  const { request, platform, url } = event;
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  const method = methodForAuthPath(path);
  if (method && !enabledAuthMethods(event).has(method)) return notFound();

  if (request.method === 'POST' && path === '/api/auth/sign-in/anonymous') return notFound();

  if (request.method === 'POST' && (path === SIGN_IN_EMAIL || path === REQUEST_PASSWORD_RESET)) {
    const isSignIn = path === SIGN_IN_EMAIL;
    // Reuse the limiter that already governs the equivalent form action, so the raw
    // endpoint and the form share ONE budget rather than granting a second allowance.
    const limiter = isSignIn ? platform!.env.AUTH_PASSWORD_RL : platform!.env.AUTH_LINK_RL;
    const ipLabel = isSignIn ? 'auth_pw_ip' : 'auth_link_ip';
    const acctLabel = isSignIn ? 'auth_pw_email' : 'auth_link_email';

    // Both dimensions, for the same reason the form action limits both: per-IP alone lets
    // a botnet spray one account; per-account alone lets one host spray many accounts.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const underIpLimit = await enforceRate(limiter, `${ipLabel}:${ip}`, platform!.env, {
      critical: true
    });
    const email = await readEmail(request);
    // Exceeding either is a VISIBLE 429. That leaks nothing: the bucket is keyed on what
    // the caller TYPED, and trips after N attempts whether or not the address exists — so
    // it is not an enumeration oracle. The silent refusal that DOES matter for enumeration
    // is `sendResetPassword`'s gate, which is untouched by this and still returns the
    // identical neutral response for a refused address.
    const underAccountLimit = email
      ? await enforceRate(limiter, `${acctLabel}:${email}`, platform!.env, { critical: true })
      : true;
    if (!underIpLimit || !underAccountLimit) return tooMany();
  }

  if (request.method === 'POST' && path === RESET_PASSWORD) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    // Same limiter and key prefix as signInPassword, so the reset submit and password
    // sign-in share ONE budget rather than granting a second allowance.
    const under = await enforceRate(
      platform!.env.AUTH_PASSWORD_RL,
      `auth_pw_ip:${ip}`,
      platform!.env,
      { critical: true }
    );
    if (!under) return tooMany();
  }

  return authFor(event).handler(request);
};

export const GET = handler;
export const POST = handler;
