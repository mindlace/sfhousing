import type { Cookies } from '@sveltejs/kit';
import { isE2eEnv } from '$lib/server/e2e/env';
import { mailCanBeDelivered } from '$lib/server/email/provider';
import { googleConfigured } from './google-provider';

/**
 * Sign-in methods. Magic link (with the pseudonymous account it upgrades) is on whenever
 * mail can be delivered; the others are on only when the `AUTH_METHODS` var lists them.
 * This module is the only reader of `AUTH_METHODS`.
 */
export const AUTH_METHODS = ['magic-link', 'password', 'passkey', 'google'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

const KNOWN: ReadonlySet<string> = new Set(AUTH_METHODS);

/** Parse a comma list: tokens trimmed, unknown tokens dropped, `magic-link` always in. */
export function parseAuthMethods(raw: string | undefined): ReadonlySet<AuthMethod> {
  const methods = new Set<AuthMethod>(['magic-link']);
  for (const token of (raw ?? '').split(',')) {
    const t = token.trim();
    if (KNOWN.has(t)) methods.add(t as AuthMethod);
  }
  return methods;
}

/** e2e builds only: a comma list that replaces `AUTH_METHODS` for the request. */
export const E2E_AUTH_METHODS_COOKIE = 'sfh_e2e_auth_methods';

type MethodsEnv = {
  AUTH_METHODS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

/** The methods a raw list switches on, less Google when its credentials are missing. */
export function methodsFromEnv(env: MethodsEnv, raw = env.AUTH_METHODS): ReadonlySet<AuthMethod> {
  const methods = new Set(parseAuthMethods(raw));
  if (!googleConfigured(env)) methods.delete('google');
  return methods;
}

/**
 * The methods in effect for this request. Magic link is dropped when no mail provider is
 * configured (`mailCanBeDelivered`): a link sent in log mode reaches no one. An e2e build
 * keeps it, because its mail sink stands in for a provider.
 */
export function enabledAuthMethods(event: {
  platform?: App.Platform;
  cookies?: Pick<Cookies, 'get'>;
}): ReadonlySet<AuthMethod> {
  const env = (event.platform?.env ?? {}) as MethodsEnv;
  const e2e = isE2eEnv(event.platform);
  const override = e2e ? event.cookies?.get(E2E_AUTH_METHODS_COOKIE) : undefined;
  const methods = new Set(methodsFromEnv(env, override ?? env.AUTH_METHODS));
  if (!e2e && !mailCanBeDelivered(event.platform)) methods.delete('magic-link');
  return methods;
}

const AUTH_PREFIX = '/api/auth';
const PASSWORD_PATHS = new Set([
  '/sign-in/email',
  '/sign-up/email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password'
]);
const GOOGLE_PATHS = new Set(['/sign-in/social', '/link-social']);
// The always-installed Better-Auth paths that send mail: the sign-in link, the email
// verification mail, and the email change (its approve link, and the confirm mail that
// `/verify-email` sends on to the new address). They follow magic link, which is in
// effect only while mail can be delivered. `/magic-link/verify` sends nothing and stays open.
const MAIL_PATHS = new Set([
  '/sign-in/magic-link',
  '/send-verification-email',
  '/change-email',
  '/verify-email'
]);

/**
 * The switchable method a Better-Auth endpoint belongs to, or null for an always-on one.
 * Password: sign-in and sign-up by email, the reset request, the reset (and its
 * `/reset-password/:token` link), change and verify. Passkey: everything under
 * `/passkey/`. Google: social sign-in, linking and every `/callback/:id`. Magic link: the
 * paths that send mail (`MAIL_PATHS`). A trailing slash does not change the answer.
 */
export function methodForAuthPath(path: string): AuthMethod | null {
  if (!path.startsWith(`${AUTH_PREFIX}/`)) return null;
  const rest = path.slice(AUTH_PREFIX.length).replace(/\/+$/, '');
  if (PASSWORD_PATHS.has(rest) || rest.startsWith('/reset-password/')) return 'password';
  if (rest.startsWith('/passkey/')) return 'passkey';
  if (MAIL_PATHS.has(rest)) return 'magic-link';
  if (GOOGLE_PATHS.has(rest) || rest.startsWith('/callback/')) return 'google';
  return null;
}
