// The cross-layer seam no unit or component test can reach: an emailed token, minted in one
// request and redeemed in another, actually replaces the credential. Policy, the gate, error
// states and copy are covered below e2e.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { AUTH_COPY } from '../src/lib/account/copy';
import { enableAuthMethods, loginAs, readMail, uniqueEmail } from './helpers/auth';
import { gotoAccount, submitPasswordForm } from './helpers/account';

test.use({ storageState: { cookies: [], origins: [] } });

// Randomized per run: the reset action runs a real breach check, so any memorable literal is
// liable to be a known breach and fail for reasons unrelated to this seam.
const oldPassword = `sfh-e2e-old-${randomUUID()}`;
const newPassword = `sfh-e2e-new-${randomUUID()}`;

test('a verified user resets a forgotten password and signs in with the new one', async ({
  page,
  context,
  request
}) => {
  // 1. A verified, email-bound account with a known password.
  await enableAuthMethods(context, ['password']);
  const email = uniqueEmail('reset');
  await loginAs(page, email);
  await gotoAccount(page);
  await page.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
  await page.getByLabel(ACCOUNT_COPY.passwordLabel, { exact: true }).fill(oldPassword);
  await submitPasswordForm(page);
  await expect(page.getByTestId('password-done')).toHaveText(ACCOUNT_COPY.passwordSetDone);

  // 2. Forget it: drop the session and ask for a reset.
  await context.clearCookies();
  await enableAuthMethods(context, ['password']);
  await page.goto('/forgot-password');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel(AUTH_COPY.forgotIdentifierLabel).fill(email);
  await page.getByTestId('request-reset-submit').click();
  await expect(page.getByTestId('reset-sent')).toHaveText(AUTH_COPY.forgotSent);

  // 3. Follow the emailed link: Better-Auth validates the token and lands on our form.
  await page.goto(await readMail(request, 'password-reset', email));
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');

  // 4. Set the new password. "New password" is a substring of "Confirm new password".
  await page.getByLabel(AUTH_COPY.resetNewLabel, { exact: true }).fill(newPassword);
  await page.getByLabel(AUTH_COPY.resetConfirmLabel).fill(newPassword);
  await page.getByTestId('reset-submit').click();
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByTestId('reset-done')).toBeVisible();

  // 5. The OLD password no longer works.
  await page.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(email);
  await page.getByLabel(AUTH_COPY.passwordLabel, { exact: true }).fill(oldPassword);
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('identifier-error')).toBeVisible();

  // 6. The NEW password does.
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(email);
  await page.getByLabel(AUTH_COPY.passwordLabel, { exact: true }).fill(newPassword);
  await page.getByTestId('password-submit').click();
  await expect(page).not.toHaveURL(/\/signin/);
});
