import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable, expectNoFooter } from './helpers/chrome';

/** No axe violations and no horizontal overflow. */
async function expectCleanPage(page: Page, path: string): Promise<void> {
  await expectNoA11yViolations(page, { structure: path === '/about' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
}

// The map pages have no footer; the header's About entry stands in for its links. The game's own
// states are in game-a11y.spec.ts.
const MAP = new Set(['/']);

for (const path of MAP) {
  test(`${path} has no a11y violations, no horizontal overflow, no footer and the About entry`, async ({
    page
  }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expectCleanPage(page, path);
    await expectNoFooter(page);
    await expectAboutReachable(page);
  });
}

test('/about has no a11y violations, no horizontal overflow and visible footer link', async ({
  page
}) => {
  const res = await page.goto('/about');
  expect(res?.status()).toBe(200);
  await expectCleanPage(page, '/about');
  await expect(page.getByRole('link', { name: 'Data & licences' })).toBeVisible();
});

for (const path of ['/no-such-page', '/fzp', '/lesscars']) {
  test(`${path} answers 404 with no a11y violations, no horizontal overflow and visible footer link`, async ({
    page
  }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectCleanPage(page, path);
    await expect(page.getByRole('link', { name: 'Data & licences' })).toBeVisible();
  });
}

for (const path of ['/fzp?seed=1', '/lesscars?day=100']) {
  test(`${path} answers 404 with the root error page`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
  });
}

test('/attribution redirects to /about at Data and licences, which is clean', async ({ page }) => {
  await page.goto('/attribution');
  await expect(page).toHaveURL(/\/about#about-data$/);
  await expectCleanPage(page, '/about');
});

test('home page never scrolls vertically', async ({ page }) => {
  await page.goto('/');
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)
  ).toBe(true);
});
