import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { AUTH_COPY } from '$lib/account/copy';
import { safeReturnTo } from '$lib/account/safe-redirect';
import { authFor, getAuth } from '$lib/server/auth/better-auth';
import { resolveHandleToEmail } from '$lib/server/auth/magic-link';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { requireMethod } from '$lib/server/auth/require-method';
import { getDb } from '$lib/server/db';
import { isE2eEnv } from '$lib/server/e2e/env';
import {
  clearPendingIdentifier,
  readPendingIdentifier
} from '$lib/server/onboarding/pending-identifier';
import { clearPendingSim, readPendingSim } from '$lib/server/onboarding/pending-sim';
import { mintPseudonymousSession } from '$lib/server/onboarding/pseudonymous-mint';
import { enforceRate } from '$lib/server/security/rate-limit';
import { createSim } from '$lib/server/sims/sims';
import { checkSimTitle } from '$lib/server/sims/start-sim';
import { normalizeHandle } from '$lib/server/user-store/handle-normalize';
import { reseedHandleFromSim } from '$lib/server/user-store/identity';

export const load: PageServerLoad = async (event) => {
  const { locals, url, cookies } = event;
  // A signed-in user has no reason to be here.
  if (locals.user) {
    throw redirect(303, safeReturnTo(url.searchParams.get('returnTo')));
  }
  const methods = enabledAuthMethods(event);
  // A magic link that failed (expired, used) comes back marked by sendLink's errorCallbackURL;
  // any other ?error is Google's, and says something only while Google is on.
  const linkError = url.searchParams.get('link') === 'failed';
  return {
    // ?signup=1 flips the page to Sign-up: email-only, no passkey.
    signup: url.searchParams.has('signup'),
    linkError,
    googleError: !linkError && methods.has('google') && url.searchParams.has('error'),
    // A sim title stashed by startSim's known-device redirect: resumed once auth
    // completes, or handed to the start-fresh escape hatch below.
    pendingSim: readPendingSim(cookies),
    // An identifier typed on a prior step (the invite page): seeded into the form
    // rather than asked for again. WCAG 2.2 SC 3.3.7 Redundant Entry.
    pendingIdentifier: readPendingIdentifier(cookies),
    // Set by the reset-password action's redirect: all sessions were revoked, so the
    // user lands here to prove the new password.
    reset: url.searchParams.has('reset'),
    // The sign-in methods switched on for this request; the page renders only those.
    methods: [...methods]
  };
};

export const actions: Actions = {
  sendLink: async (event) => {
    // No mail provider (or magic link otherwise off): nothing would reach the inbox.
    requireMethod(event, 'magic-link');
    const { request, platform, url } = event;
    const form = await request.formData();
    const identifier = String(form.get('identifier') ?? '').trim();
    if (!identifier) return fail(400, { error: AUTH_COPY.enterIdentifier });

    // Per-IP velocity (best-effort, test-inert).
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (
      !(await enforceRate(platform!.env.AUTH_LINK_RL, `auth_link_ip:${ip}`, platform!.env, {
        critical: true
      }))
    ) {
      return fail(429, { error: AUTH_COPY.tooManySignin });
    }

    const db = getDb(platform!);
    // An '@' means a raw email (cold-signup-eligible); otherwise treat it as a handle.
    const email = identifier.includes('@')
      ? identifier.toLowerCase()
      : await resolveHandleToEmail(db, identifier);

    // Per-email velocity, only when we have a real address to throttle.
    if (email) {
      // Exceeding it is silent (neutral response, no send) so a 429 can't be used to
      // probe whether an email address exists. The IP limit above is the visible
      // throttle; this one fails closed without leaking.
      const underEmailLimit = await enforceRate(
        platform!.env.AUTH_LINK_RL,
        `auth_link_email:${email}`,
        platform!.env,
        { critical: true }
      );
      if (underEmailLimit) {
        // Test-only seam: the API response never includes the verification URL, so the
        // e2e dev-link helper captures it synchronously from sendMagicLink (same request).
        // Only an e2e build arms it; the sink is never wired in staging or production.
        const wantDevLink = isE2eEnv(platform);
        let devLink: string | undefined;
        const auth = getAuth(platform!, url.origin, {
          captureMagicLink: wantDevLink
            ? ({ url: verifyUrl }) => {
                devLink = verifyUrl;
              }
            : undefined
        });
        const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
        const keep = returnTo === '/' ? '' : `&returnTo=${encodeURIComponent(returnTo)}`;
        await auth.api.signInMagicLink({
          headers: request.headers,
          body: {
            email,
            callbackURL: returnTo,
            // An expired or used link lands back here, where the page says so.
            errorCallbackURL: `/signin?link=failed${keep}`
          }
        });
        // The link is sent: the stash has served its purpose, same one-shot
        // treatment as the pending-sim cookie.
        clearPendingIdentifier(event.cookies);
        if (wantDevLink) {
          return { sent: true, devLink };
        }
      }
    }
    // Neutral response whether or not we actually sent: no account enumeration.
    return { sent: true };
  },

  /**
   * Password sign-in: handle + password, no email required (a pseudonymous account's
   * email is the anonymous plugin's synthetic address, which resolves fine). Refused
   * with a 404 when password sign-in is off.
   *
   * Deliberately as uninformative as sendLink: ONE generic error covers unknown-handle,
   * no-password-set, and wrong-password alike, so a caller cannot probe which handles
   * exist or which have passwords. Do not "improve" any of these into a specific message.
   *
   * Resolution goes through resolveHandleToEmail then signInEmail. Better-Auth's
   * `username` plugin is deliberately NOT installed, and this is one of the two reasons
   * why: its lookup matches on the confusable-collapsed skeleton, while sendLink matches
   * the canonical handle, so installing it would let one typed identifier route to two
   * different accounts depending on which sign-in method you picked. (The other reason
   * is the handle-enumeration endpoints it publishes.) Do not reach for it here.
   *
   * Timing side channel (deliberately not closed): an unknown handle short-circuits
   * after a single D1 select, while a known handle proceeds into signInEmail and a KDF
   * comparison: a measurable handle-existence oracle despite the byte-identical error.
   * This is accepted, not fixed, on two grounds: handles are already PUBLIC identifiers
   * in this product (they appear in invites and member lists), so existence is not a
   * secret the error message was protecting; and the oracle sits behind the 5/60s rate
   * limit above, which is what actually makes bulk probing impractical. Do not add a
   * dummy KDF comparison to "fix" this: that would just be a different,
   * harder-to-maintain leak.
   */
  signInPassword: async (event) => {
    if (!enabledAuthMethods(event).has('password')) {
      return fail(404, { error: AUTH_COPY.signinFailed });
    }
    const { request, platform, url } = event;
    const form = await request.formData();
    // A leading '@' is how people write handles. getUserByHandle strips it, but
    // resolveHandleToEmail is reached directly here and normalizeHandle does not
    // strip it, so strip it at the door or '@alice' fails to resolve.
    const identifier = String(form.get('identifier') ?? '')
      .trim()
      .replace(/^@/, '');
    const password = String(form.get('password') ?? '');
    if (!identifier || !password) return fail(400, { error: AUTH_COPY.signinFailed });

    // Brute force is the threat a password adds that a magic link never had. Limit BOTH
    // dimensions: per-IP alone lets a botnet spray one account; per-handle alone lets one
    // host spray many accounts. Unlike sendLink's per-email limit, exceeding either is
    // VISIBLE (429): the throttle is keyed on what the caller typed, not on whether an
    // account exists, so it reveals nothing either way.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const underIpLimit = await enforceRate(
      platform!.env.AUTH_PASSWORD_RL,
      `auth_pw_ip:${ip}`,
      platform!.env,
      { critical: true }
    );
    const underHandleLimit = await enforceRate(
      platform!.env.AUTH_PASSWORD_RL,
      `auth_pw_handle:${normalizeHandle(identifier)}`,
      platform!.env,
      { critical: true }
    );
    if (!underIpLimit || !underHandleLimit) {
      return fail(429, { error: AUTH_COPY.tooManySignin });
    }

    const db = getDb(platform!);
    // An '@' means a raw email; otherwise treat it as a handle (mirrors sendLink).
    const email = identifier.includes('@')
      ? identifier.toLowerCase()
      : await resolveHandleToEmail(db, identifier);
    if (!email) return fail(400, { error: AUTH_COPY.signinFailed });

    // authFor: the instance for THIS request's methods (the e2e cookie can switch password on).
    const auth = authFor(event);
    try {
      await auth.api.signInEmail({ headers: request.headers, body: { email, password } });
    } catch {
      // Every failure mode collapses here on purpose; see the doc comment above.
      return fail(400, { error: AUTH_COPY.signinFailed });
    }
    clearPendingIdentifier(event.cookies);
    throw redirect(303, safeReturnTo(url.searchParams.get('returnTo')));
  },

  // The escape hatch for a shared or known device: mints a fresh pseudonymous identity
  // regardless of the known-device cookie (that's the whole point), still behind the mint
  // seam's IP velocity brake. Resumes the stashed sim title if present; an expired stash
  // lands on /sims.
  startFresh: async (event) => {
    const title = readPendingSim(event.cookies);
    // "I am not that person" is a declaration of intent, complete the instant this action
    // runs, regardless of whether the mint below succeeds. Clearing only on the mint's
    // success path would leave a stranger's address seeded on the very re-render (a
    // rate-limited mint) where the escape hatch most needs to have worked.
    clearPendingIdentifier(event.cookies);
    const minted = await mintPseudonymousSession(event);
    // Distinct key: `error` belongs to sendLink's identifier field, so reusing it
    // here would stamp aria-invalid on a field this action never touched.
    if (!minted.ok) return fail(minted.status, { startFreshError: minted.message });
    if (!title) throw redirect(303, '/sims');
    clearPendingSim(event.cookies);
    // The cookie is user-controlled: it gets the same checks as a typed title.
    const checked = checkSimTitle(title);
    if (!('title' in checked)) throw redirect(303, '/sims');
    const db = getDb(event.platform!);
    await reseedHandleFromSim({ db, identityId: minted.user.id, simTitle: checked.title });
    const { simId } = await createSim({ db, title: checked.title, managerId: minted.user.id });
    throw redirect(303, `/sims/${simId}`);
  }
};
