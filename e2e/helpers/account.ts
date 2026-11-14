// Helpers for the /account page specs.
import { expect, type Page } from '@playwright/test';
import { ACCOUNT_COPY } from '../../src/lib/account/account-copy';
import { SIMS_COPY } from '../../src/lib/members/copy';

/** Open /account and wait for hydration (the panes are client components). */
export async function gotoAccount(page: Page): Promise<void> {
  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

/** Become a pseudonymous visitor by creating a sim, which mints the account. */
export async function startPseudonymous(page: Page, title: string): Promise<void> {
  await page.goto('/sims');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel(SIMS_COPY.titleLabel).fill(title);
  await page.getByRole('button', { name: SIMS_COPY.create }).click();
  await page.waitForURL(/\/sims\/[^/]+$/);
}

/** The signed-in account's handle, read from the Profile pane. */
export async function readHandle(page: Page): Promise<string> {
  const handle = (await page.locator('#handle').inputValue()).trim();
  expect(handle).not.toHaveLength(0);
  return handle;
}

/** Submit the open password form (the Profile pane has its own Save button). */
export async function submitPasswordForm(page: Page): Promise<void> {
  await page
    .locator('form', { has: page.locator('#new-password') })
    .getByRole('button', { name: ACCOUNT_COPY.save, exact: true })
    .click();
}
