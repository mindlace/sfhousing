// The per-page accessibility checklist (docs/dev/accessibility.md) on the game's page in each of
// its states, on both projects (1280 and 375 px): axe clean, no horizontal scroll, one main and one
// h1, the first Tab from body on the skip link, the header's About entry reachable, and the state's
// own control reached by Tab with a visible focus ring. The rounds (policy-rounds spec): pending,
// a win with the gift, late, an explainer open, the round panel open, a New policy's pane and an
// editable policy's editor. Runs against the VITE_E2E build on fixture-0, at the goal amount 1 for
// the opening and at FIXTURE_AMOUNT for the rounds; every wait is a state in the page or in
// storage.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable } from './helpers/chrome';
import { seedGoalAmount } from './helpers/game';
import type { GameState } from '../src/lib/game/state';
import {
  FIXTURE_AMOUNT,
  autosaveOff,
  focusBody,
  frameMap,
  monthDay,
  openGamePanel,
  policyRow,
  refusePolicyRecord,
  seedRuns,
  staleEdit,
  tabTo,
  updating,
  waitResult,
  waitSim
} from './helpers/play';
import { installPolicyHold, openKind, slider, waitFilled } from './helpers/run';
import { gotoEditor, gotoHydrated, openHeaderMenu, paintOnce } from './helpers/sharing';

/**
 * The checklist in one state. `own` are the state's own controls (closing spec, sec-design-a11y),
 * each reached by Tab from body (from the Menu when a header action waits there) and matching
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

// ---- the rounds ---------------------------------------------------------------------------------

/** A seeded game in the runs at FIXTURE_AMOUNT, on the simulation with the forecast filled. */
async function roundPage(page: Page, state: Partial<GameState>): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRuns(page, { phase: 'runs', ...state }, FIXTURE_AMOUNT);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await frameMap(page);
  await waitFilled(page);
}

/** The ruler's End: the playhead at the window's last month, every month seen. */
async function toEnd(page: Page): Promise<void> {
  await slider(page).focus();
  await page.keyboard.press('End');
}

const goalButton = (page: Page): Locator => page.getByTestId('goal-headline-button');
const gift = (page: Page): Locator => page.getByTestId('goal-gift');

// Current law reaches FIXTURE_AMOUNT in Aug 2038: a target of Jan 2045 is beaten, Jan 2035 is not.
const BEATEN = monthDay(2045, 1);
const MISSED = monthDay(2035, 1);

test('a round pending', async ({ page }) => {
  await roundPage(page, { round: 1, target: BEATEN });
  await expect(page.getByTestId('goal-headline')).toHaveAttribute('data-state', 'pending');
  await checkState(page, goalButton(page));
});

test('a round won, the gift showing', async ({ page }) => {
  await roundPage(page, { round: 1, target: BEATEN });
  await toEnd(page);
  await waitResult(page, 'win');
  await expect(gift(page)).toHaveAccessibleName('Open the gift: 3 new policies');
  await expect(page.getByTestId('goal-live')).toHaveText(
    /early\. Open the gift: 3 new policies\.$/
  );
  await checkState(page, gift(page));
});

test('a round late', async ({ page }) => {
  await roundPage(page, { round: 1, target: MISSED });
  await toEnd(page);
  await waitResult(page, 'late');
  await expect(page.getByTestId('goal-live')).toHaveText(/late\.$/);
  await checkState(page, goalButton(page));
});

test('an explainer open: modal, focus on Accept and held there', async ({ page }) => {
  await roundPage(page, { round: 1, target: BEATEN });
  await toEnd(page);
  await waitResult(page, 'win');
  await gift(page).click();
  const dialog = page.getByTestId('gift-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Taller near Muni Metro' })).toBeVisible();
  const accept = dialog.getByTestId('gift-accept');
  await expect(accept).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(accept).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(accept).toBeFocused();
  expect(await accept.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  // The page behind a native modal is inert: the gift is not reachable.
  expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);
  await expectNoA11yViolations(page);
});

test('the round panel open; Escape closes it with focus back on the goal', async ({ page }) => {
  await roundPage(page, { round: 1, target: BEATEN });
  await waitResult(page, 'pending');
  await focusBody(page);
  await tabTo(page, goalButton(page));
  await page.keyboard.press('Enter');
  await expect(goalButton(page)).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByTestId('round-panel');
  await expect(panel).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(goalButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await expect(goalButton(page)).toBeFocused();
});

test("a New policy's pane", async ({ page }) => {
  await roundPage(page, { round: 1, target: BEATEN });
  await openKind(page, 'Zoning');
  const button = policyRow(page, 'transit-rail').getByTestId('tl-policy-new');
  await expect(button).toHaveAccessibleName('New: Taller near BART and Caltrain, details');
  await button.click();
  const pane = page.getByTestId('policy-details');
  await expect(pane).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Taller near BART and Caltrain', exact: true })
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("an editable policy's editor", async ({ page }) => {
  await roundPage(page, { round: 2, target: BEATEN, editable: ['transit-rail'] });
  await openKind(page, 'Zoning');
  const button = policyRow(page, 'transit-rail').getByTestId('tl-policy-edit');
  await expect(button).toHaveAccessibleName('Edit Taller near BART and Caltrain');
  await button.click();
  const editor = page.getByTestId('inspector');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Within metres, band 2')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a round beside Updating and Autosave off at 375 px: the status icons', async ({ page }) => {
  await refusePolicyRecord(page);
  await installPolicyHold(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await roundPage(page, { round: 1, target: BEATEN });
  await staleEdit(page);
  await expect(autosaveOff(page)).toBeVisible();
  await expect(updating(page)).toBeVisible();
  await expect(page.getByTestId('tl-status-spinner')).toBeVisible();
  await expectNoA11yViolations(page);
});
