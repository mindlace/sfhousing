import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { authFor } from '$lib/server/auth/better-auth';
import { requireMethod } from '$lib/server/auth/require-method';
import { isE2eEnv } from '$lib/server/e2e/env';
import { isValidEmail } from '$lib/server/email/validate';
import { enforceRate } from '$lib/server/security/rate-limit';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';

export const POST: RequestHandler = async (event) => {
  // Sends mail: off (404) while magic link is, that is while no mail provider is configured.
  requireMethod(event, 'magic-link');
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { locals, request, platform } = event;
  if (!locals.user) return json({ error: ACCOUNT_COPY.signinRequired }, { status: 401 });
  // A pseudonymous user adds an address; a registered one whose address is unconfirmed
  // (`emailVerified` false) confirms that address, and only that one.
  const confirmingOwn = !locals.user.pseudonymous && !locals.user.emailVerified;
  if (!locals.user.pseudonymous && !confirmingOwn) {
    return json({ emailError: ACCOUNT_COPY.emailAlreadySet }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = (confirmingOwn ? locals.user.email : String(body?.email ?? ''))
    .trim()
    .toLowerCase();
  if (!isValidEmail(email)) {
    return json({ emailError: ACCOUNT_COPY.invalidEmail, email }, { status: 400 });
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (
    !(await enforceRate(platform!.env.AUTH_LINK_RL, `auth_link_ip:${ip}`, platform!.env, {
      critical: true
    }))
  ) {
    return json({ emailError: ACCOUNT_COPY.tooManyRequests }, { status: 429 });
  }
  const underEmailLimit = await enforceRate(
    platform!.env.AUTH_LINK_RL,
    `auth_link_email:${email}`,
    platform!.env,
    { critical: true }
  );
  if (underEmailLimit) {
    let devLink: string | undefined;
    const auth = authFor(event, {
      captureMagicLink: isE2eEnv(platform)
        ? ({ url: link }) => {
            devLink = link;
          }
        : undefined
    });
    await auth.api.signInMagicLink({
      headers: request.headers,
      // An expired or used link lands on /account, where the page says so.
      body: { email, callbackURL: '/', errorCallbackURL: '/account?link=failed' }
    });
    return json({ emailSent: true, email, devLink });
  }
  return json({ emailSent: true, email });
};
