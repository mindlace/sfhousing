// The cross-layer seam a unit or component test cannot reach: a password set on a
// pseudonymous session survives the session boundary itself. Policy, breach check, reset gate,
// remove guard and error states are covered by unit and component tests.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { AUTH_COPY } from '../src/lib/account/copy';
import { enableAuthMethods } from './helpers/auth';
import { gotoAccount, submitPasswordForm, readHandle, startPseudonymous } from './helpers/account';

test.use({ storageState: { cookies: [], origins: [] } });

// Randomized per run: the set-password endpoint runs a real breach check, so any memorable
// literal is liable to be a known breach and fail for reasons unrelated to this seam.
const password = `sfh-e2e-${randomUUID()}`;

test('a pseudonymous user sets a password and signs back in with their handle', async ({
  page,
  context
}) => {
  await enableAuthMethods(context, ['password']);
  await startPseudonymous(page);

  await gotoAccount(page);
  const handle = await readHandle(page);

  await page.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
  await page.getByLabel(ACCOUNT_COPY.passwordLabel, { exact: true }).fill(password);
  await submitPasswordForm(page);
  await expect(page.getByTestId('password-done')).toHaveText(ACCOUNT_COPY.passwordSetDone);
  await expect(page.getByTestId('password-status')).toHaveText(
    ACCOUNT_COPY.passwordAddRecoveryNudge
  );

  // Drop the session entirely (and with it the per-test methods cookie), then sign back in
  // with handle and password.
  await context.clearCookies();
  await enableAuthMethods(context, ['password']);
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(handle);
  await page.getByLabel(AUTH_COPY.passwordLabel, { exact: true }).fill(password);
  await page.getByTestId('password-submit').click();
  await expect(page).not.toHaveURL(/\/signin/);

  // Authenticated again, as the same account.
  await gotoAccount(page);
  await expect(page.getByLabel(ACCOUNT_COPY.handleLabel)).toHaveValue(handle);
});

test('a password set can be removed only while another way in remains', async ({
  page,
  context
}) => {
  await enableAuthMethods(context, ['password']);
  await startPseudonymous(page);
  await gotoAccount(page);
  await page.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
  await page.getByLabel(ACCOUNT_COPY.passwordLabel, { exact: true }).fill(password);
  await submitPasswordForm(page);
  await expect(page.getByTestId('password-done')).toHaveText(ACCOUNT_COPY.passwordSetDone);

  // A pseudonymous account's only durable factor is the password: it cannot be removed.
  await gotoAccount(page);
  await expect(page.getByRole('button', { name: ACCOUNT_COPY.remove })).toBeDisabled();
  await expect(page.getByText(ACCOUNT_COPY.passwordLastFactor)).toBeVisible();
});
