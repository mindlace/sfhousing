// Auth helpers for e2e specs. They lean on the e2e-only seams (/api/e2e/login,
// /api/e2e/mail and the sign-in methods cookie), which exist only in the VITE_E2E build.
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import type { E2eMailKind } from '../../src/lib/server/e2e/mail-sink';

/** `E2E_AUTH_METHODS_COOKIE` in src/lib/server/auth/methods.ts (that module imports `$lib`,
 *  which the Playwright loader cannot resolve). */
const E2E_AUTH_METHODS_COOKIE = 'sfh_e2e_auth_methods';

/** Sign the page's context in as `email` (a registered user, minted on first use). The
 *  session cookie lands in the context's cookie jar, so later navigations are signed in. */
export async function loginAs(page: Page, email: string): Promise<{ userId: string }> {
  const res = await page.request.post('/api/e2e/login', { data: { email } });
  expect(res.status(), 'POST /api/e2e/login').toBe(200);
  return (await res.json()) as { userId: string };
}

/** Switch on sign-in methods for this test's own browser context (replaces AUTH_METHODS;
 *  magic link stays on). Ignored by the server outside an e2e build. */
export async function enableAuthMethods(context: BrowserContext, methods: string[]): Promise<void> {
  await context.addCookies([
    { name: E2E_AUTH_METHODS_COOKIE, value: methods.join(','), domain: 'localhost', path: '/' }
  ]);
}

// Follow the test-only magic link (`dev-link`) shown after requesting a sign-in /
// email-confirm link. The link is a full-page nav through better-auth's verify
// endpoint, which 302s off `/signin`; wait for that landing so the session is set.
// Pass `{ hydrate: true }` when the callback lands on an app page you'll interact
// with and you need hydration before the next action.
export async function followMagicLink(page: Page, opts: { hydrate?: boolean } = {}): Promise<void> {
  await page.getByTestId('dev-link').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
  if (opts.hydrate) await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

/** The link the latest `kind` mail to `to` carried. Polls: Better-Auth may send the mail
 *  after its response returns. */
export async function readMail(
  request: APIRequestContext,
  kind: E2eMailKind,
  to: string
): Promise<string> {
  let url = '';
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `/api/e2e/mail?kind=${encodeURIComponent(kind)}&to=${encodeURIComponent(to)}`
        );
        if (res.status() !== 200) return '';
        url = ((await res.json()) as { url: string }).url;
        return url;
      },
      { message: `${kind} mail to ${to}` }
    )
    .not.toBe('');
  return url;
}

/** What `/api/auth/get-session` answers: null when signed out. */
export type Session = { user?: { id: string; isAnonymous?: boolean } } | null;

/** The page's context's current session, read from Better-Auth. */
export async function sessionOf(page: Page): Promise<Session> {
  const res = await page.request.get('/api/auth/get-session');
  expect(res.status()).toBe(200);
  return (await res.json()) as Session;
}

/** An address no other test (or retry) uses. */
export function uniqueEmail(tag: string): string {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${tag}-${nonce}@e2e.test`;
}
