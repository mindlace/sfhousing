// Pseudonymous onboarding at /sims: a first visit mints an account behind the scenes,
// creating a sim redirects into it, and a known device is steered to /signin.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SIMS_COPY } from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { sessionOf } from './helpers/auth';

const SESSION_COOKIE = 'better-auth.session_token';

test.use({ storageState: { cookies: [], origins: [] } });

async function createSim(page: Page, title: string) {
  await page.goto('/sims');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel(SIMS_COPY.titleLabel).fill(title);
  await page.getByRole('button', { name: SIMS_COPY.create }).click();
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
  // exact: a random handle such as "@first-operational" also matches a substring name
  await expect(page.getByRole('link', { name: 'First', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Second', exact: true })).toBeVisible();
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
  expect(names).toEqual([SESSION_COOKIE]);
});

/** The root layout data (`user` is null when signed out) as the browser would load it. */
async function layoutDataWith(
  context: BrowserContext,
  baseURL: string,
  cookie: string
): Promise<{
  status: number;
  body: string;
  setCookie: string[];
  cacheControl: string | undefined;
}> {
  const res = await context.request.get(`${baseURL}/__data.json`, { headers: { cookie } });
  return {
    status: res.status(),
    body: await res.text(),
    setCookie: res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value),
    cacheControl: res.headers()['cache-control']
  };
}

test('a garbage session cookie on / is a signed-out 200 with no cookie set', async ({
  browser,
  baseURL,
  page
}) => {
  // Control: a valid session makes the root layout data carry the user's handle.
  await createSim(page, 'Control');
  await page.waitForURL(/\/sims\/[^/]+$/);
  const valid = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE)!;
  const signedIn = await layoutDataWith(
    page.context(),
    baseURL!,
    `${SESSION_COOKIE}=${valid.value}`
  );
  expect(signedIn.body).toContain('"handle"');

  const context = await browser.newContext();
  try {
    const home = await context.request.get(`${baseURL}/`, {
      headers: { cookie: `${SESSION_COOKIE}=garbage` }
    });
    expect(home.status()).toBe(200);
    expect(home.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie')).toEqual([]);
    expect(home.headers()['cache-control']).toBe('private, no-cache');

    const garbage = await layoutDataWith(context, baseURL!, `${SESSION_COOKIE}=garbage`);
    expect(garbage.status).toBe(200);
    expect(garbage.body).not.toContain('"handle"');
    expect(garbage.setCookie).toEqual([]);
  } finally {
    await context.close();
  }
});

test('axe: /sims and a sim page', async ({ page }) => {
  await page.goto('/sims');
  await expect(page.getByLabel(SIMS_COPY.titleLabel)).toBeVisible();
  await expectNoA11yViolations(page);
  await createSim(page, 'Accessible');
  await page.waitForURL(/\/sims\/[^/]+$/);
  await expectNoA11yViolations(page);
});
