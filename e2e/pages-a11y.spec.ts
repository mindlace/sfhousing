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

// The map pages have no footer; the header's About entry stands in for its links.
const MAP = new Set(['/', '/fzp']);

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

for (const path of ['/about', '/no-such-page']) {
  test(`${path} has no a11y violations, no horizontal overflow and visible footer link`, async ({
    page
  }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(path === '/no-such-page' ? 404 : 200);
    await expectCleanPage(page, path);
    await expect(page.getByRole('link', { name: 'Data & licences' })).toBeVisible();
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
