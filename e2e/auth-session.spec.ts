import { expect, test } from '@playwright/test';
import { loginAs, uniqueEmail } from './helpers/auth';

const MANIFEST = '/data/fixture-0/manifest.json';

test('loginAs signs the context in: get-session returns the email', async ({ page }) => {
  const email = uniqueEmail('session');
  const { userId } = await loginAs(page, email);
  expect(userId).toBeTruthy();
  const res = await page.request.get('/api/auth/get-session');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { user?: { email?: string } } | null;
  expect(body?.user?.email).toBe(email);
});

test('a signed-out visitor gets no cookie from / or /data/', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    for (const path of ['/', MANIFEST]) {
      const res = await context.request.get(path);
      expect(res.status(), path).toBe(200);
      const setCookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
      expect(setCookies, path).toEqual([]);
    }
    expect(await context.cookies()).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a signed-in visitor gets no cookie from /data/', async ({ page }) => {
  await loginAs(page, uniqueEmail('data'));
  const res = await page.request.get(MANIFEST);
  expect(res.status()).toBe(200);
  const setCookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
  expect(setCookies).toEqual([]);
});
