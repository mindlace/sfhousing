import { expect, test, type Page } from '@playwright/test';
import { AUTH_COPY } from '../src/lib/account/copy';
import { followMagicLink, uniqueEmail } from './helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoSignin(page: Page, path = '/signin'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

test('cold signup: a never-seen email creates an account via the link', async ({ page }) => {
  const email = uniqueEmail('cold');
  await gotoSignin(page);
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(email);
  await page.getByRole('button', { name: AUTH_COPY.emailMeLink }).click();
  await expect(page.getByTestId('form-status')).toHaveText(AUTH_COPY.emailSent);
  await followMagicLink(page);

  // A registered account now exists and the session is active, so /signin redirects away.
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { email?: string } } | null;
  expect(body?.user?.email).toBe(email);
  await page.goto('/signin');
  await expect(page).not.toHaveURL(/\/signin/);
});

test('the link lands on a safe returnTo', async ({ page }) => {
  const email = uniqueEmail('return');
  await gotoSignin(page, '/signin?returnTo=/about');
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(email);
  await page.getByRole('button', { name: AUTH_COPY.emailMeLink }).click();
  await followMagicLink(page);
  await expect(page).toHaveURL(/\/about$/);
});
