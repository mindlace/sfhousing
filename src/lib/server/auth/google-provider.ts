/** Origin Better-Auth sends the browser to when it initiates a Google sign-in. Pages whose
 *  sign-in is a form submission must list this in `form-action` — browsers enforce that
 *  directive across the redirect chain a form kicks off, so `form-action 'self'` alone blocks
 *  the hop to Google (see `kit.csp` in `svelte.config.js`). */
export const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';

/** Google sign-in needs both OAuth credentials; without them the method stays off whatever
 *  `AUTH_METHODS` says. */
export function googleConfigured(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Google OAuth provider config. `disableImplicitSignUp: true` means a Google sign-in mints a
 *  brand-new account ONLY when the sign-in call passes `requestSignUp: true`. Without that flag an
 *  unknown Google account is refused: Better-Auth returns `signup disabled`, creates nothing, and
 *  bounces to the caller's `errorCallbackURL` with `?error=signup_disabled`.
 *
 *  The normal onboarding button at /signin passes `requestSignUp: true`, so first-time users
 *  still self-onboard there. A sign-in that omits `requestSignUp` signs in existing
 *  accounts only. Existing-account sign-in and account-linking (linkSocial) are unaffected —
 *  they never reach the create branch. */
export function googleProvider(env: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string }) {
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    disableImplicitSignUp: true
  };
}
