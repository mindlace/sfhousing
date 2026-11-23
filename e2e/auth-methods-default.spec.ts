// Under the default methods (magic link and the pseudonymous account only) /signin offers
// neither a password, a passkey nor Google, and every endpoint behind them refuses.
import { expect, test, type Page } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { AUTH_COPY } from '../src/lib/account/copy';
import { enableAuthMethods, loginAs, uniqueEmail } from './helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoSignin(page: Page): Promise<void> {
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

test('/signin renders no password, passkey or Google control by default', async ({ page }) => {
  await gotoSignin(page);
  await expect(page.getByRole('button', { name: AUTH_COPY.emailMeLink })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start fresh without an account' })).toHaveCount(0);
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

test('/account renders no password, passkey or Google control by default', async ({ page }) => {
  await loginAs(page, uniqueEmail('default-account'));
  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await expect(page.getByRole('heading', { name: ACCOUNT_COPY.emailHeading })).toBeVisible();
  await expect(page.getByRole('heading', { name: ACCOUNT_COPY.passwordHeading })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: ACCOUNT_COPY.passkeysHeading })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: ACCOUNT_COPY.googleHeading })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ACCOUNT_COPY.passwordSet })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ACCOUNT_COPY.passkeyAdd })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ACCOUNT_COPY.googleConnect })).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('the password API answers 404 to POST and DELETE by default, even when signed in', async ({
  page,
  baseURL
}) => {
  await loginAs(page, uniqueEmail('default-pw-api'));
  const headers = { origin: baseURL! };
  const post = await page.request.post('/api/account/password', {
    headers,
    data: { password: 'correct horse battery staple' }
  });
  expect(post.status()).toBe(404);
  const del = await page.request.delete('/api/account/password', { headers, data: {} });
  expect(del.status()).toBe(404);
});

test('the account API answers with password off, and the password route is reached once it is on', async ({
  page,
  context,
  baseURL
}) => {
  await loginAs(page, uniqueEmail('default-account-api'));
  const get = await page.request.get('/api/account');
  expect(get.status()).toBe(200);
  expect(await get.json()).toEqual({
    hasGoogle: false,
    hasPassword: false,
    canRemovePassword: expect.any(Boolean),
    pseudonymous: false
  });

  // With password switched on for this context the route is reached: a too-short password is
  // a 400 from the route itself, not the 404 of a method that is off.
  await enableAuthMethods(context, ['password']);
  const short = await page.request.post('/api/account/password', {
    headers: { origin: baseURL! },
    data: { password: 'short' }
  });
  expect(short.status()).toBe(400);
});
