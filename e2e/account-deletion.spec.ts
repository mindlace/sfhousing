// Account deletion from /account. Each run mints its own account, so the destructive delete
// never touches a user other specs rely on.
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY, deleteConfirmLine } from '../src/lib/account/account-copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { loginAs, uniqueEmail } from './helpers/auth';
import { gotoAccount, readHandle, startPseudonymous } from './helpers/account';
import { openHeaderMenu } from './helpers/sharing';

test.use({ storageState: { cookies: [], origins: [] } });

test('a wrong handle keeps the delete button off; cancel returns focus to the trigger', async ({
  page
}) => {
  await loginAs(page, uniqueEmail('delete-guard'));
  await gotoAccount(page);
  const trigger = page.getByRole('button', { name: ACCOUNT_COPY.deleteButton });
  await trigger.click();
  await expect(page.locator('#confirmHandle')).toBeFocused();
  const confirmButton = page.getByRole('button', { name: ACCOUNT_COPY.deletePermanently });
  await expect(confirmButton).toBeDisabled();
  await page.locator('#confirmHandle').fill('not-my-handle');
  await expect(confirmButton).toBeDisabled();

  await page.getByRole('button', { name: ACCOUNT_COPY.cancel }).click();
  await expect(trigger).toBeFocused();
  // Nothing was deleted.
  expect((await page.request.get('/api/account')).status()).toBe(200);
});

test('a pseudonymous visitor deletes their account and ends signed out', async ({ page }) => {
  await startPseudonymous(page);
  expect((await page.request.get('/api/account')).status()).toBe(200);

  await gotoAccount(page);
  const handle = await readHandle(page);
  await page.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
  await expect(page.getByText(deleteConfirmLine(handle))).toBeVisible();
  await expectNoA11yViolations(page);
  const confirm = page.getByLabel(ACCOUNT_COPY.deleteConfirmLabel);
  await confirm.fill(handle);
  await expect(confirm).toHaveValue(handle);
  await page.getByRole('button', { name: ACCOUNT_COPY.deletePermanently }).click();
  await page.waitForURL((url) => url.pathname === '/');

  // Signed out: no session, and the account API refuses.
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await openHeaderMenu(page);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })
  ).toBeVisible();
});
