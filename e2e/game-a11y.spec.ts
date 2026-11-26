// The per-page accessibility checklist (docs/dev/accessibility.md) on the game's page in each of
// its states (closing spec, sec-design-a11y), on both projects: axe clean, no horizontal scroll,
// one main and one h1, the first Tab from body on the skip link, the header's About entry
// reachable, and the state's own control reached by Tab with a visible focus ring. Runs against
// the VITE_E2E build on fixture-0 at the goal amount 1; every wait is a state in the page or in
// storage.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable } from './helpers/chrome';
import { seedGoalAmount } from './helpers/game';
import { openGamePanel, seedRuns, tabTo, waitSim } from './helpers/play';
import { gotoEditor, gotoHydrated, openHeaderMenu, paintOnce } from './helpers/sharing';

/** Puts focus on body and makes it the start of sequential focus navigation. */
async function focusBody(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
}

/**
 * The checklist in one state. `own` are the state's own controls (closing spec, sec-design-a11y),
 * each reached by Tab from body (from the Menu below lg, where a header action waits) and matching
 * `:focus-visible`; a state the spec names no control for passes none.
 */
async function checkState(page: Page, ...own: Locator[]): Promise<void> {
  await expectNoA11yViolations(page);
  await checkStructure(page);
  await checkReach(page, ...own);
}

/** No horizontal scroll, one main, one h1, and the first Tab from body on the skip link. */
async function checkStructure(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await focusBody(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
}

/** The header's About entry reachable, and each of `own` reached by Tab with a visible ring. */
async function checkReach(page: Page, ...own: Locator[]): Promise<void> {
  // The skip link is in flow while focused: a click on the header would blur it and move the
  // header under the pointer, so the check starts with focus on body.
  await focusBody(page);
  await expectAboutReachable(page);
  for (const control of own) {
    if (!(await control.isVisible())) await openHeaderMenu(page);
    await focusBody(page);
    await tabTo(page, control);
    expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  }
}

test('the opening', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.getByTestId('opening-start')).toHaveCount(0);
  await checkState(page);
});

/** Tab from body to the skip link; no horizontal scroll and axe clean with it still focused. */
async function scanSkipFocused(page: Page): Promise<void> {
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await focusBody(page);
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectNoA11yViolations(page);
  await expect(skip).toBeFocused();
}

test('the skip link focused, in the opening', async ({ page }) => {
  await gotoEditor(page);
  await scanSkipFocused(page);
  await expect(page.locator('h1')).toHaveCount(1);
});

test('the skip link focused, in the simulation', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await scanSkipFocused(page);
  await expect(page.locator('h1')).toHaveCount(1);
});

test('the opening with the room goal met', async ({ page, isMobile }) => {
  await seedGoalAmount(page, 1);
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  const start = page.getByTestId('opening-start');
  await expect(start).toBeVisible();
  await checkState(page, start);
});

test('the game panel open', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await expect(await openGamePanel(page)).toBeVisible();
  await checkState(page);
});

test('the side goals open', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitSim(page);
  const headline = page.getByTestId('goal-headline-button');
  await headline.click();
  await expect(headline).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('side-goals')).toBeVisible();
  await checkState(page);
});
