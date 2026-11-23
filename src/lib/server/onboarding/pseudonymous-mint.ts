import type { RequestEvent } from '@sveltejs/kit';
import { authFor } from '$lib/server/auth/better-auth';
import { getDb } from '$lib/server/db';
import { resolveSessionUser, type User } from '$lib/server/user-store/user';
import { enforceRate } from '$lib/server/security/rate-limit';
import { AUTH_COPY } from '$lib/account/copy';

type Deps = {
  signIn?: () => Promise<{ user: { id: string } } | null>;
  resolve?: (liveId: string) => Promise<User | null>;
};

/** Mint a pseudonymous session (Better-Auth anonymous plugin) behind the IP
 * velocity brake. The session cookie is set on the response via sveltekitCookies.
 * The ONE mint seam: whatever mints a pseudonymous session calls this rather than
 * touching `auth.api.signInAnonymous()` directly. */
export async function mintPseudonymousSession(
  event: RequestEvent,
  deps: Deps = {}
): Promise<{ ok: true; user: User } | { ok: false; status: 429 | 500; message: string }> {
  const ip = event.request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const allowed = await enforceRate(
    event.platform!.env.PSEUDO_MINT_RL,
    `pseudo_mint:${ip}`,
    event.platform!.env,
    { critical: true }
  );
  if (!allowed) return { ok: false, status: 429, message: AUTH_COPY.tooManyAccounts };
  const signIn = deps.signIn ?? (() => authFor(event).api.signInAnonymous());
  // Lazy: only touches the D1 binding when actually falling back to the real
  // resolver, so an injected `deps.resolve` (as in tests) never needs a DB stub.
  const resolve =
    deps.resolve ?? ((liveId: string) => resolveSessionUser(getDb(event.platform!), liveId));
  // Use the RETURNED user: the session cookie is only on the response, so a
  // follow-up getSession would read stale request headers.
  const signedIn = await signIn();
  const u = signedIn?.user ? await resolve(signedIn.user.id) : null;
  if (!u) return { ok: false, status: 500, message: AUTH_COPY.sessionStart };
  return { ok: true, user: u };
}
