import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { AUTH_COPY } from '$lib/account/copy';
import { authFor } from '$lib/server/auth/better-auth';
import { resolveHandleToEmail } from '$lib/server/auth/magic-link';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { getDb } from '$lib/server/db';
import { enforceRate } from '$lib/server/security/rate-limit';

/** Password reset exists only where password sign-in is on; everywhere else it is a 404. */
function requirePassword(event: Parameters<typeof enabledAuthMethods>[0]): void {
  if (!enabledAuthMethods(event).has('password')) throw error(404);
}

export const load: PageServerLoad = (event) => {
  requirePassword(event);
  return {};
};

export const actions: Actions = {
  /**
   * Request a password-reset link.
   *
   * Mirrors sendLink's defenses in the same order and for the same reasons: the
   * per-IP limit is VISIBLE (keyed on the caller, leaks nothing), the per-email
   * limit is SILENT (a 429 there would be an enumeration oracle).
   *
   * The response is neutral in every branch: unknown identifier, gate-refused
   * account, or a real send. Most accounts are pseudonymous or unverified and
   * `mayReceivePasswordReset` refuses them silently; that is by design, not a bug.
   */
  requestReset: async (event) => {
    requirePassword(event);
    const { request, platform } = event;
    const form = await request.formData();
    // A leading '@' is how people write handles; resolveHandleToEmail does not
    // strip it, so strip it at the door (same as signInPassword).
    const identifier = String(form.get('identifier') ?? '')
      .trim()
      .replace(/^@/, '');
    if (!identifier) return fail(400, { error: AUTH_COPY.enterIdentifier });

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (
      !(await enforceRate(platform!.env.AUTH_LINK_RL, `auth_link_ip:${ip}`, platform!.env, {
        critical: true
      }))
    ) {
      return fail(429, { error: AUTH_COPY.tooManySignin });
    }

    const db = getDb(platform!);
    const email = identifier.includes('@')
      ? identifier.toLowerCase()
      : await resolveHandleToEmail(db, identifier);

    if (email) {
      const underEmailLimit = await enforceRate(
        platform!.env.AUTH_LINK_RL,
        `auth_link_email:${email}`,
        platform!.env,
        { critical: true }
      );
      if (underEmailLimit) {
        // `redirectTo` is load-bearing. Without it Better-Auth builds the link with an
        // empty callbackURL, and its GET handler bounces the user to a generic
        // ?error=INVALID_TOKEN page instead of our form. It must be same-origin (the
        // handler wraps it in originCheck), which a root-relative path satisfies.
        await authFor(event).api.requestPasswordReset({
          headers: request.headers,
          body: { email, redirectTo: '/reset-password' }
        });
      }
    }

    // Neutral whether or not we sent: no account enumeration.
    return { sent: true };
  }
};
