import { expect, test, type Page } from '@playwright/test';
import { AUTH_COPY } from '../src/lib/account/copy';
import { SIMS_COPY } from '../src/lib/members/copy';
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

test('a known device resumes its sim after signing in by link', async ({
  page,
  context,
  baseURL
}) => {
  // sfh_known sends sim creation to /signin?returnTo=/sims with the title stashed; the link
  // lands back on /sims, whose load creates the sim and drops the visitor into it.
  const email = uniqueEmail('resume');
  await context.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
  await page.goto('/sims');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel(SIMS_COPY.titleLabel).fill('Resumed');
  await page.getByRole('button', { name: SIMS_COPY.create }).click();
  await page.waitForURL((url) => url.pathname === '/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(email);
  await page.getByRole('button', { name: AUTH_COPY.emailMeLink }).click();
  await followMagicLink(page);
  await page.waitForURL(/\/sims\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Resumed');
  expect((await context.cookies()).map((c) => c.name)).not.toContain('sfh_pending_sim');
});

test('the link lands on a safe returnTo', async ({ page }) => {
  const email = uniqueEmail('return');
  await gotoSignin(page, '/signin?returnTo=/sims');
  await page.getByLabel(AUTH_COPY.identifierLabel).fill(email);
  await page.getByRole('button', { name: AUTH_COPY.emailMeLink }).click();
  await followMagicLink(page);
  await expect(page).toHaveURL(/\/sims$/);
});
