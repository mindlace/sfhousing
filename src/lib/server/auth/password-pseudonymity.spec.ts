import { describe, it, expect, vi } from 'vitest';
import { freshDb, makePlatform } from '$lib/server/test/auth-db';
import { PSEUDONYMOUS_EMAIL_DOMAIN } from './brand';
import type { AuthMethod } from './methods';
import { PASSWORD_MIN_LENGTH } from './password-policy';

/**
 * The `sveltekitCookies` plugin calls `getRequestEvent()` in an after-hook to mirror
 * Set-Cookie onto the SvelteKit response. In the app that always runs inside `handle`;
 * here there is no request, so it throws. Stub it with the only surface the plugin
 * touches (`event.cookies.set`) — the session cookie we care about is read off the
 * returned Headers, not off this stub.
 */
vi.mock('$app/server', () => ({
  getRequestEvent: () => ({ cookies: { set: () => {} } })
}));

const { getAuth } = await import('./better-auth');

/**
 * THE CENTRAL PREMISE OF PASSWORD AUTH: a password makes a pseudonymous account DURABLE
 * without ending its pseudonymity. Email and Google do end it — they attach contact info
 * and drive the anonymous plugin's `onLinkAccount` upgrade/fuse. A password attaches
 * nothing, so it must not.
 *
 * Today the only thing enforcing that is an argument in a comment: `auth.api.setPassword`
 * is declared `createAuthEndpoint.serverOnly(...)`, so it has no request path, so the
 * anonymous plugin's path-matched `onLinkAccount` hook cannot fire for it. That argument
 * is a fact about a DEPENDENCY, not about our code — a Better-Auth release that gives
 * setPassword a path, or that broadens the hook's matcher, silently de-pseudonymizes every
 * user who sets a password. Nothing else would catch it: the pseudonymous rules
 * key off `isAnonymous` (a pseudonymous account with no credential has no way back in),
 * so the blast radius (those accounts are no longer treated as pseudonymous, the UI flips)
 * is invisible to every other test.
 *
 * Hence an END-TO-END assertion against the real Better-Auth instance rather than a unit
 * test of our own code — the behavior under test belongs to the dependency.
 */

/** Password sign-in is off by default; these cases run with it on. */
const METHODS: ReadonlySet<AuthMethod> = new Set(['magic-link', 'password']);

function fakePlatform() {
  const { shim } = freshDb();
  return makePlatform(shim, {
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret'
  });
}

const BASE_URL = 'http://localhost:5173';
const PASSWORD = `pw-${'x'.repeat(PASSWORD_MIN_LENGTH)}`;

/** Mint a pseudonymous account and return its auth instance plus a session cookie header. */
async function pseudonymousSession() {
  const auth = getAuth(fakePlatform(), BASE_URL, { methods: METHODS });
  const { headers, response } = await auth.api.signInAnonymous({ returnHeaders: true });
  const setCookie = headers.get('set-cookie');
  if (!setCookie) throw new Error('anonymous sign-in returned no session cookie');
  const cookie = setCookie
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .join('; ');
  return { auth, cookie: new Headers({ cookie }), userId: response!.user.id };
}

async function readUser(auth: Awaited<ReturnType<typeof pseudonymousSession>>['auth'], id: string) {
  const ctx = await auth.$context;
  return (await ctx.internalAdapter.findUserById(id)) as unknown as {
    isAnonymous?: boolean | null;
    email: string;
  };
}

describe('setting a password preserves pseudonymity', () => {
  it('leaves isAnonymous true after a password is set', async () => {
    const { auth, cookie, userId } = await pseudonymousSession();
    expect((await readUser(auth, userId)).isAnonymous).toBe(true);

    await auth.api.setPassword({ headers: cookie, body: { newPassword: PASSWORD } });

    // If this flips, Better-Auth gave setPassword a request path (or widened the
    // anonymous plugin's onLinkAccount matcher). Do NOT relax this assertion —
    // fix the auth config so a password stays a non-identifying credential.
    expect((await readUser(auth, userId)).isAnonymous).toBe(true);
  });

  it('leaves the synthetic pseudonymous email untouched after a password is set', async () => {
    const { auth, cookie, userId } = await pseudonymousSession();
    const before = (await readUser(auth, userId)).email;
    expect(before.endsWith(`@${PSEUDONYMOUS_EMAIL_DOMAIN}`)).toBe(true);

    await auth.api.setPassword({ headers: cookie, body: { newPassword: PASSWORD } });

    // No contact info was attached, so the address must be byte-identical.
    expect((await readUser(auth, userId)).email).toBe(before);
  });

  it('actually set the password (the invariant above is not vacuously true)', async () => {
    const { auth, cookie, userId } = await pseudonymousSession();
    await auth.api.setPassword({ headers: cookie, body: { newPassword: PASSWORD } });

    const ctx = await auth.$context;
    const accounts = await ctx.internalAdapter.findAccounts(userId);
    const credential = accounts.find((a) => a.providerId === 'credential');
    expect(credential?.password).toBeTruthy();
  });
});
