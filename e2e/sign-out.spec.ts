// Sign out from /account: the session ends, the visitor lands on / signed out, and the header
// shows no handle. Only an account that can sign back in is offered it.
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { AUTH_COPY } from '../src/lib/account/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { gotoAccount, readHandle, startPseudonymous } from './helpers/account';
import { loginAs, uniqueEmail } from './helpers/auth';
import { openHeaderMenu } from './helpers/sharing';

const SESSION_COOKIE = 'better-auth.session_token';

test.use({ storageState: { cookies: [], origins: [] } });

test('an account with an email signs out from /account and lands on / signed out', async ({
  page,
  context
}) => {
  await loginAs(page, uniqueEmail('signout'));
  await gotoAccount(page);
  const handle = await readHandle(page);
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: ACCOUNT_COPY.signOut, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');

  // The session cookie is gone and the account API no longer knows this visitor.
  expect((await context.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE);
  expect((await page.request.get('/api/account')).status()).toBe(401);

  // The header carries no handle; the e2e build keeps magic link, so Sign in is offered.
  await openHeaderMenu(page);
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('link', { name: `@${handle}`, exact: true })).toHaveCount(0);
  await expect(banner.locator('[data-header-account]')).toHaveText(AUTH_COPY.signIn);
});

test('a fresh pseudonymous account is offered no Sign out', async ({ page }) => {
  await startPseudonymous(page, `No Sign Out ${Date.now()}`);
  await gotoAccount(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACCOUNT_COPY.heading);
  await expect(page.getByRole('button', { name: ACCOUNT_COPY.signOut, exact: true })).toHaveCount(
    0
  );
});
