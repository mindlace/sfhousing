// Changing the handle on /account: it saves, shows in the header at once, and persists.
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { loginAs, uniqueEmail } from './helpers/auth';
import { gotoAccount } from './helpers/account';
import { openHeaderMenu } from './helpers/sharing';

test.use({ storageState: { cookies: [], origins: [] } });

// A handle change tombstones the old handle and enforces a 7-day per-identity cooldown, so
// each run mints its own user: no prior tombstone, no cooldown.
test('a registered user can change their handle and it persists', async ({ page }) => {
  await loginAs(page, uniqueEmail('account-edit'));
  await gotoAccount(page);

  const newHandle = `qa-handle-${Date.now().toString(36)}`;
  const handleInput = page.getByLabel(ACCOUNT_COPY.handleLabel);
  await expect(handleInput).toBeVisible();
  await handleInput.fill(newHandle);
  // fill() and an immediate click can otherwise serialize a partial value.
  await expect(handleInput).toHaveValue(newHandle);
  await page.getByRole('button', { name: ACCOUNT_COPY.save, exact: true }).click();

  await expect(page.getByTestId('form-status')).toHaveText(ACCOUNT_COPY.saved);

  // The header shows the new handle without a reload.
  await openHeaderMenu(page);
  await expect(page.getByRole('banner').getByRole('link', { name: `@${newHandle}` })).toBeVisible();

  // Reload: the handle persisted.
  await gotoAccount(page);
  await expect(page.getByLabel(ACCOUNT_COPY.handleLabel)).toHaveValue(newHandle);
});

test('a taken handle is refused with an associated, focused error', async ({ page, browser }) => {
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const otherPage = await other.newPage();
  await loginAs(otherPage, uniqueEmail('handle-owner'));
  await gotoAccount(otherPage);
  const taken = await otherPage.locator('#handle').inputValue();
  await other.close();

  await loginAs(page, uniqueEmail('handle-wanter'));
  await gotoAccount(page);
  await page.locator('#handle').fill(taken);
  await page.getByRole('button', { name: ACCOUNT_COPY.save, exact: true }).click();
  await expect(page.getByTestId('handle-error')).toBeVisible();
  await expect(page.locator('#handle')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#handle')).toHaveAttribute('aria-describedby', 'handle-error');
  await expect(page.locator('#handle')).toBeFocused();
});
