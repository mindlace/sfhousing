import type { Cookies } from '@sveltejs/kit';
import { isE2eEnv } from '$lib/server/e2e/env';
import { googleConfigured } from './google-provider';

/**
 * Sign-in methods. Magic link (with the pseudonymous account it upgrades) is always on;
 * the others are on only when the `AUTH_METHODS` var lists them. This module is the only
 * reader of `AUTH_METHODS`.
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

/** The methods switched on for this request. */
export function enabledAuthMethods(event: {
  platform?: App.Platform;
  cookies?: Pick<Cookies, 'get'>;
}): ReadonlySet<AuthMethod> {
  const env = (event.platform?.env ?? {}) as MethodsEnv;
  const override = isE2eEnv(event.platform)
    ? event.cookies?.get(E2E_AUTH_METHODS_COOKIE)
    : undefined;
  return methodsFromEnv(env, override ?? env.AUTH_METHODS);
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

/**
 * The switchable method a Better-Auth endpoint belongs to, or null for an always-on one.
 * Password: sign-in and sign-up by email, the reset request, the reset (and its
 * `/reset-password/:token` link), change and verify. Passkey: everything under
 * `/passkey/`. Google: social sign-in, linking and every `/callback/:id`. A trailing slash
 * does not change the answer.
 */
export function methodForAuthPath(path: string): AuthMethod | null {
  if (!path.startsWith(`${AUTH_PREFIX}/`)) return null;
  const rest = path.slice(AUTH_PREFIX.length).replace(/\/+$/, '');
  if (PASSWORD_PATHS.has(rest) || rest.startsWith('/reset-password/')) return 'password';
  if (rest.startsWith('/passkey/')) return 'passkey';
  if (GOOGLE_PATHS.has(rest) || rest.startsWith('/callback/')) return 'google';
  return null;
}
