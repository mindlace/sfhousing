// Pseudonymous onboarding at /sims: a first visit mints an account behind the scenes,
// creating a sim redirects into it, and a known device is steered to /signin.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';

const SESSION_COOKIE = 'better-auth.session_token';

test.use({ storageState: { cookies: [], origins: [] } });

async function createSim(page: Page, title: string) {
  await page.goto('/sims');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel('Sim title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
}

type Session = { user?: { id: string; isAnonymous?: boolean } } | null;

async function sessionOf(page: Page): Promise<Session> {
  const res = await page.request.get('/api/auth/get-session');
  expect(res.status()).toBe(200);
  return (await res.json()) as Session;
}

test('a fresh visitor creates a sim, lands on it, and is a pseudonymous user', async ({ page }) => {
  await createSim(page, 'Garden Party');
  await page.waitForURL(/\/sims\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garden Party');
  const session = await sessionOf(page);
  expect(session?.user?.isAnonymous).toBe(true);
});

test('a second sim keeps the same user', async ({ page }) => {
  await createSim(page, 'First');
  await page.waitForURL(/\/sims\/[^/]+$/);
  const first = (await sessionOf(page))?.user?.id;
  expect(first).toBeTruthy();
  await createSim(page, 'Second');
  await page.waitForURL(/\/sims\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Second');
  expect((await sessionOf(page))?.user?.id).toBe(first);
  await page.goto('/sims');
  await expect(page.getByRole('link', { name: 'First' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Second' })).toBeVisible();
});

test('creating on a known device redirects to /signin', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
  await createSim(page, 'Comeback');
  await page.waitForURL((url) => url.pathname === '/signin');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/sims');
});

test('after the create redirect the context holds the session cookie and no known-device cookie', async ({
  page,
  context
}) => {
  await createSim(page, 'Cookies');
  await page.waitForURL(/\/sims\/[^/]+$/);
  const names = (await context.cookies()).map((c) => c.name).sort();
  console.log(`cookies after the redirect: ${names.join(', ')}`);
  expect(names).toContain(SESSION_COOKIE);
  expect(names).not.toContain('sfh_known');
});

test('a garbage session cookie on / is a signed-out 200', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  try {
    const res = await context.request.get(`${baseURL}/`, {
      headers: { cookie: `${SESSION_COOKIE}=garbage` }
    });
    const setCookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    console.log(
      `garbage cookie: status=${res.status()} set-cookie=${JSON.stringify(setCookies.map((h) => h.value))} cache-control=${res.headers()['cache-control']}`
    );
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain('Sign out');
  } finally {
    await context.close();
  }
});

test('axe: /sims and a sim page', async ({ page }) => {
  await page.goto('/sims');
  await expect(page.getByLabel('Sim title')).toBeVisible();
  await expectNoA11yViolations(page);
  await createSim(page, 'Accessible');
  await page.waitForURL(/\/sims\/[^/]+$/);
  await expectNoA11yViolations(page);
});
