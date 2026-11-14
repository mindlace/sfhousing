// Under the default methods (magic link and the pseudonymous account only) /signin offers
// neither a password, a passkey nor Google, and every endpoint behind them refuses.
import { expect, test, type Page } from '@playwright/test';
import { AUTH_COPY } from '../src/lib/account/copy';
import { enableAuthMethods } from './helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoSignin(page: Page): Promise<void> {
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

test('/signin renders no password, passkey or Google control by default', async ({ page }) => {
  await gotoSignin(page);
  await expect(page.getByRole('button', { name: AUTH_COPY.emailMeLink })).toBeVisible();
  await expect(page.getByRole('button', { name: AUTH_COPY.startFresh })).toBeVisible();
  await expect(page.getByRole('button', { name: AUTH_COPY.usePassword })).toHaveCount(0);
  await expect(page.getByLabel(AUTH_COPY.passwordLabel)).toHaveCount(0);
  await expect(page.getByRole('button', { name: AUTH_COPY.passkeyButton })).toHaveCount(0);
  await expect(page.getByRole('button', { name: AUTH_COPY.googleButton })).toHaveCount(0);
  await expect(page.getByText(AUTH_COPY.chooseOne)).toHaveCount(0);
});

test('POST /api/auth/sign-in/email is 404 by default', async ({ page, baseURL }) => {
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: baseURL! },
    data: { email: 'someone@e2e.test', password: 'correct horse battery staple' }
  });
  expect(res.status()).toBe(404);
});

test('the signInPassword action refuses with 404 by default', async ({ page, baseURL }) => {
  const res = await page.request.post('/signin?/signInPassword', {
    headers: { origin: baseURL!, 'x-sveltekit-action': 'true' },
    form: { identifier: 'someone', password: 'correct horse battery staple' }
  });
  const body = (await res.json()) as { type: string; status: number };
  expect(body).toMatchObject({ type: 'failure', status: 404 });
});

test('/forgot-password and /reset-password answer 404 by default', async ({ page }) => {
  expect((await page.request.get('/forgot-password')).status()).toBe(404);
  expect((await page.request.get('/reset-password?token=abc')).status()).toBe(404);
});

test('the password reset actions refuse with 404 by default', async ({ page, baseURL }) => {
  const headers = { origin: baseURL!, 'x-sveltekit-action': 'true' };
  const forgot = await page.request.post('/forgot-password?/requestReset', {
    headers,
    form: { identifier: 'someone@e2e.test' }
  });
  expect(forgot.status()).toBe(404);
  const password = 'correct horse battery staple';
  const reset = await page.request.post('/reset-password?/resetPassword', {
    headers,
    form: { token: 't', password, confirm: password }
  });
  expect(reset.status()).toBe(404);
});

test('switching password and passkey on renders their controls', async ({ page, context }) => {
  await enableAuthMethods(context, ['password', 'passkey']);
  await gotoSignin(page);
  await expect(page.getByRole('button', { name: AUTH_COPY.usePassword })).toBeVisible();
  await expect(page.getByRole('button', { name: AUTH_COPY.passkeyButton })).toBeVisible();
  // Google also needs credentials the e2e build does not hold.
  await expect(page.getByRole('button', { name: AUTH_COPY.googleButton })).toHaveCount(0);
});
