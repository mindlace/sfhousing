// Helpers for the /account page specs.
import { expect, type Page } from '@playwright/test';
import { ACCOUNT_COPY } from '../../src/lib/account/account-copy';

/** Open /account and wait for hydration (the panes are client components). */
export async function gotoAccount(page: Page): Promise<void> {
  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

/** Sign this context in as a fresh pseudonymous account. */
export async function startPseudonymous(page: Page): Promise<void> {
  const res = await page.request.post('/api/e2e/login', { data: { pseudonymous: true } });
  expect(res.ok()).toBe(true);
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
