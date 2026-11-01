// Dark chrome (sim-runs spec §8): the header and the /sim timeline bar take dark variants and stay
// WCAG AA; light-only panels (the scoreboard) keep the light accent. Both Playwright projects.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { gotoEditor } from './helpers/sharing';

type FzpWin = Window & { __sfhFzp?: SfhFzpDebug };

test.use({ colorScheme: 'dark' });

async function gotoSim(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await expect(page.locator('.sfh-fzp-scrubber')).toBeVisible();
}

/** Below md the scoreboard is a sheet behind its bar; from md it is already open. */
async function openScoreboard(page: Page, isMobile: boolean): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Housing scoreboard' });
  if (!isMobile) return region;
  await region.getByRole('button', { name: /net new homes/ }).tap();
  await expect(page.getByRole('group', { name: 'Scoreboard details' })).toBeVisible();
  return region;
}

test('/ header has no axe violations in dark', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.getByRole('banner')).toBeVisible();
  await expectNoA11yViolations(page, { include: ['header'] });
});

test('/sim header and timeline bar have no axe violations in dark', async ({ page }) => {
  await gotoSim(page);
  await expect(page.getByRole('banner')).toBeVisible();
  await expectNoA11yViolations(page, { include: ['header', '.sfh-fzp-scrubber'] });
});

test('at 375px the open Menu has no axe violations in dark', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoEditor(page);
  const menu = page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('navigation', { name: 'Modes' }).getByRole('link', { name: 'Paint' })
  ).toBeVisible();
  await expectNoA11yViolations(page, { include: ['header'] });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});

test('the header is dark in dark mode', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.getByRole('banner')).toHaveCSS('background-color', 'rgb(28, 29, 31)');
});

test('light-only panels keep the light accent in dark mode', async ({ page, isMobile }) => {
  await gotoEditor(page);
  const region = await openScoreboard(page, isMobile);
  // One bar fill per target row: the primary target's (the h-4 meter) is the one under test.
  // Below md the primary row renders twice (the bar and the open sheet); both share the classes.
  const fill = region.locator('[data-primary="true"] [data-testid="bar-fill"]').first();
  await expect(fill).toBeAttached();
  await expect(fill).toHaveCSS('background-color', 'rgb(163, 71, 44)');
});
