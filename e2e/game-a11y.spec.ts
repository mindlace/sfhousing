// The per-page accessibility checklist (docs/dev/accessibility.md) on the game's page in each of
// its states (closing spec, sec-design-a11y), on both projects: axe clean, no horizontal scroll,
// one main and one h1, the first Tab from body on the skip link, the header's About entry
// reachable, and the state's own control reached by Tab with a visible focus ring. Runs against
// the VITE_E2E build on fixture-0 at the goal amount 1; every wait is a state in the page or in
// storage.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable } from './helpers/chrome';
import { seedGame, seedGoalAmount, seedRunMs } from './helpers/game';
import {
  buyNode,
  firstReady,
  openGamePanel,
  playToEnding,
  runLayer,
  seedRuns,
  tabTo,
  untilPhase,
  waitPhase
} from './helpers/play';
import { waitFilled } from './helpers/run';
import { gotoEditor, gotoHydrated, openHeaderMenu, paintOnce } from './helpers/sharing';

const node = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="tree-node"][data-node="${id}"]`);

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
  await expectAboutReachable(page);
  for (const control of own) {
    if (!(await control.isVisible())) await openHeaderMenu(page);
    await focusBody(page);
    await tabTo(page, control);
    expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  }
}

/** The tree after one run at the goal amount 1: the lump paid, so a node is ready. */
async function treeAfterRun(page: Page): Promise<void> {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await page.getByTestId('tree-run').click();
  await untilPhase(page, 'tally');
  await page.getByTestId('tally-continue').click();
  await waitPhase(page, 'tree');
  await expect(page.locator('[data-testid="tree-node"][data-state="ready"]').first()).toBeVisible();
}

/** Opens `firstReady`'s node; returns its id. */
async function openReady(page: Page): Promise<string> {
  const id = await firstReady(page);
  await node(page, id).getByTestId('tree-node-open').first().click();
  await expect(page.getByTestId('tree-detail')).toBeVisible();
  return id;
}

test('the opening', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.getByTestId('opening-start')).toHaveCount(0);
  await checkState(page);
});

test('the opening with the room goal met', async ({ page, isMobile }) => {
  await seedGoalAmount(page, 1);
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  const start = page.getByTestId('opening-start');
  await expect(start).toBeVisible();
  await checkState(page, start);
});

test('a run, with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedGoalAmount(page, 1);
  await seedRunMs(page, 8000);
  await seedGame(page, { phase: 'runs', runs: 1 });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await page.getByTestId('tree-run').click();
  await untilPhase(page, 'run');
  await expect(runLayer(page)).toHaveAttribute('data-state', 'running');

  // The structure checks and the axe scan run inside the run: the layer is running before them
  // and still running after them. The About check comes last: in this state it can take longer
  // than what is left of the run, and nothing in it depends on the run still going.
  await test.step('structure and axe, inside the 8,000 ms run', async () => {
    await checkStructure(page);
    // Focus back on body: the focused skip link would lie over the header for the scan.
    await focusBody(page);
    await expectNoA11yViolations(page);
  });

  await expect(runLayer(page)).toHaveAttribute('data-state', 'running');

  await test.step('About', () => checkReach(page));
});

test('the tally', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await page.getByTestId('tree-run').click();
  await untilPhase(page, 'tally');
  const next = page.getByTestId('tally-continue');
  await expect(next).toBeFocused();
  await checkState(page, next);
});

test('the tree with a node open', async ({ page }) => {
  await treeAfterRun(page);
  await openReady(page);
  // The tree covers the map: axe scans the pane, not the map.
  const box = page.getByTestId('tl-map-box');
  await expect(box).toHaveAttribute('inert', '');
  await expect(box).toHaveAttribute('aria-hidden', 'true');
  await checkState(page, page.getByTestId('tree-buy'), page.getByTestId('tree-run'));
});

test('the workshop', async ({ page }) => {
  await treeAfterRun(page);
  const id = await firstReady(page);
  expect((await buyNode(page, id, 'pointer')).state.bought[id]).toBe(1);
  await node(page, id).getByTestId('tree-node-edit').click();
  await waitPhase(page, 'workshop');
  await waitFilled(page);
  await checkState(page, page.getByTestId('game-back'));
});

test('the game panel open', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await expect(await openGamePanel(page)).toBeVisible();
  await checkState(page);
});

test('the side goals open', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  const headline = page.getByTestId('goal-headline-button');
  await headline.click();
  await expect(headline).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('side-goals')).toBeVisible();
  await checkState(page);
});

test('the ending', async ({ page }) => {
  await playToEnding(page);
  await expect(page.getByTestId('tree-ending')).toBeVisible();
  await checkState(page, page.getByTestId('tree-publish'));
});

// Review Focus 3: the two screens drawn over the map, in dark.
test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the tree with a node open and the tally pass in dark mode', async ({ page }) => {
    await seedRuns(page);
    await gotoHydrated(page, '/');
    await waitPhase(page, 'tree');
    await page.getByTestId('tree-run').click();
    await untilPhase(page, 'tally');
    await expectNoA11yViolations(page);
    await page.getByTestId('tally-continue').click();
    await waitPhase(page, 'tree');
    await expect(
      page.locator('[data-testid="tree-node"][data-state="ready"]').first()
    ).toBeVisible();
    await openReady(page);
    await expectNoA11yViolations(page);
  });
});
