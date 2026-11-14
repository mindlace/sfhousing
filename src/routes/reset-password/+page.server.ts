import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { AUTH_COPY, passwordTooLong, passwordTooShort } from '$lib/account/copy';
import { authFor } from '$lib/server/auth/better-auth';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { isPasswordBreached } from '$lib/server/auth/password-breach';
import {
  validatePasswordShape,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH
} from '$lib/server/auth/password-policy';
import { enforceRate } from '$lib/server/security/rate-limit';

/** Password reset exists only where password sign-in is on; everywhere else it is a 404. */
function requirePassword(event: Parameters<typeof enabledAuthMethods>[0]): void {
  if (!enabledAuthMethods(event).has('password')) throw error(404);
}

/**
 * Better-Auth's GET /api/auth/reset-password/:token validates the token and then
 * redirects here as `?token=<token>` on success, or `?error=INVALID_TOKEN` on a bad
 * or expired one. The GET only READS the verification row, so this page is safe to
 * reload: the token is consumed only by the POST below.
 */
export const load: PageServerLoad = (event) => {
  requirePassword(event);
  return {
    token: event.url.searchParams.get('token') ?? '',
    invalid: event.url.searchParams.has('error')
  };
};

export const actions: Actions = {
  resetPassword: async (event) => {
    requirePassword(event);
    const { request, platform } = event;
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (!token) return fail(400, { error: AUTH_COPY.resetInvalid });
    if (password !== confirm) return fail(400, { error: AUTH_COPY.resetMismatch });

    const shape = validatePasswordShape(password);
    if (!shape.ok) {
      return fail(400, {
        error:
          shape.reason === 'too-short'
            ? passwordTooShort(PASSWORD_MIN_LENGTH)
            : passwordTooLong(PASSWORD_MAX_LENGTH)
      });
    }

    // Per-IP velocity, mirroring signInPassword's shape. This action never traverses
    // the [...all] catch-all (it calls auth.api.resetPassword directly, server-side),
    // so THAT route's limiter never sees this traffic: this is the only guard in
    // front of unlimited token-guessing here. It also has to run BEFORE the breach
    // check below: isPasswordBreached makes an outbound HIBP lookup, and without this
    // gate an unauthenticated caller with a junk token could drive unlimited lookups.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (
      !(await enforceRate(platform!.env.AUTH_PASSWORD_RL, `auth_pw_ip:${ip}`, platform!.env, {
        critical: true
      }))
    ) {
      return fail(429, { error: AUTH_COPY.tooManySignin });
    }

    // Better-Auth's haveIBeenPwned() plugin gates on the endpoint path, which is why
    // password-breach.ts exists for the serverOnly setPassword call. Run it explicitly
    // here rather than assuming the plugin covers this path.
    if (await isPasswordBreached(password)) {
      return fail(400, { error: AUTH_COPY.passwordBreached });
    }

    try {
      await authFor(event).api.resetPassword({
        headers: request.headers,
        body: { token, newPassword: password }
      });
    } catch {
      // INVALID_TOKEN covers expired AND already-used (the token is single-use), and
      // the length errors cannot reach here: the shape check above already ran.
      return fail(400, { error: AUTH_COPY.resetInvalid });
    }

    // revokeSessionsOnPasswordReset killed every session and Better-Auth returns no
    // new one, so there is nothing to sign in with: send them to /signin to prove
    // the new password.
    throw redirect(303, '/signin?reset=1');
  }
};
