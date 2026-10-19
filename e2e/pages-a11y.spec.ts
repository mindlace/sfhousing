import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';

for (const path of ['/', '/about', '/attribution', '/fzp', '/no-such-page']) {
  test(`${path} has no a11y violations, no horizontal overflow and visible footer link`, async ({
    page
  }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(path === '/no-such-page' ? 404 : 200);
    await expectNoA11yViolations(page, { structure: path === '/about' || path === '/attribution' });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBe(true);
    await expect(page.getByRole('link', { name: 'Data & licences' })).toBeVisible();
  });
}

test('home page never scrolls vertically', async ({ page }) => {
  await page.goto('/');
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)
  ).toBe(true);
});
