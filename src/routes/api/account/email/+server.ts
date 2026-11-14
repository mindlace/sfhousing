import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { authFor } from '$lib/server/auth/better-auth';
import { requireMethod } from '$lib/server/auth/require-method';
import { isValidEmail } from '$lib/server/email/validate';
import { enforceRate } from '$lib/server/security/rate-limit';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';

export const PATCH: RequestHandler = async (event) => {
  // Sends mail: off (404) while magic link is, that is while no mail provider is configured.
  requireMethod(event, 'magic-link');
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { locals, request, platform } = event;
  if (!locals.user) return json({ error: 'not signed in' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = String(body?.email ?? '')
    .trim()
    .toLowerCase();
  if (!isValidEmail(email)) {
    return json({ changeError: ACCOUNT_COPY.invalidEmail, email }, { status: 400 });
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (
    !(await enforceRate(platform!.env.AUTH_LINK_RL, `auth_link_ip:${ip}`, platform!.env, {
      critical: true
    }))
  ) {
    return json({ changeError: ACCOUNT_COPY.tooManyRequests }, { status: 429 });
  }
  await authFor(event).api.changeEmail({
    headers: request.headers,
    body: { newEmail: email, callbackURL: '/' }
  });
  return json({ emailChangeSent: true, email });
};
