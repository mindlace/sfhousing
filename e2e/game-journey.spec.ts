// The game's three journeys across units (closing spec, sec-design-journey, sec-design-keyboard,
// sec-design-ending): a new visitor by pointer from Paint's room goal to the next goal and the
// account's copy; the same loop by keyboard only, collecting with the ring; and the last deadline
// met, which is the ending. Runs against the VITE_E2E build on fixture-0 with the real game
// switched on by e2e/helpers/game.ts; every wait is a state in the page or in storage.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LADDER_YEARS } from '../src/lib/game/catalogue/ladder-years';
import { PRICES, RUNG_LUMP } from '../src/lib/game/catalogue/tuning';
import type { MetRung } from '../src/lib/game/state';
import { seedGame, seedGoalAmount, seedRunMs } from './helpers/game';
import {
  buyNode,
  firstReady,
  openGamePanel,
  runTotals,
  savedGame,
  sweepRing,
  tabTo,
  waitPhase,
  waitSaved
} from './helpers/play';
import { waitFilled } from './helpers/run';
import {
  FRAME,
  gotoEditor,
  gotoHydrated,
  headerAction,
  jumpAndIdle,
  openHeaderMenu,
  ops,
  paintOnce
} from './helpers/sharing';

/** The tree's nodes that can be bought now. */
const readyNodes = (page: Page): Locator =>
  page.locator('[data-testid="tree-node"][data-state="ready"]');

const node = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="tree-node"][data-node="${id}"]`);

/**
 * The publish dialog on the simulation. `publishDialog` (helpers/sharing.ts) names Paint's
 * ("Publish this plan"); the tree's Publish opens the policy's (`dialogHeading` for a policy).
 */
const policyPublishDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: /Publish this policy|Published/ });

/** Focus is on an element that holds the map (the map box, focused in starting and run). */
const focusHoldsMap = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const a = document.activeElement;
    const root = document.querySelector('[data-testid="map-root"]');
    return (
      !!a && !!root && a !== document.body && a !== document.documentElement && a.contains(root)
    );
  });

const focusVisible = (target: Locator): Promise<boolean> =>
  target.evaluate((el) => el.matches(':focus-visible'));

/** Below lg, closes the header's Menu if it is open (Escape, as a player would); else nothing. */
async function closeHeaderMenu(page: Page): Promise<void> {
  const menu = page.getByRole('banner').locator('[data-header-menu]');
  if (!(await menu.isVisible())) return;
  if ((await menu.getAttribute('aria-expanded')) !== 'true') return;
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
}

test.describe('by pointer', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a new visitor paints to the room goal, runs, buys and takes the next goal', async ({
    page,
    isMobile
  }) => {
    // 1. A goal any stroke reaches, a short run, Paint as a new visitor.
    await seedGoalAmount(page, 1);
    await seedRunMs(page, 2000);
    await gotoEditor(page);

    // 2. The banner names the site and has no steps; the game is new.
    await expect(page.getByRole('navigation', { name: 'Steps' })).toHaveCount(0);
    await openHeaderMenu(page);
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'SF Housing', exact: true })
    ).toBeVisible();
    await closeHeaderMenu(page);
    const fresh = await waitSaved(page, (s) => s.state.phase === 'opening');
    expect(fresh.state.rung).toBe(0);
    expect(fresh.state.runs).toBe(0);

    // 3. One stroke meets the room goal: the opening's Start has focus, the first win is dated.
    await paintOnce(page, isMobile);
    const start = page.getByTestId('opening-start');
    await expect(start).toBeVisible();
    await expect(start).toBeFocused();
    const won = await waitSaved(page, (s) => s.state.firstWinAt !== null);
    expect(won.state.firstWinAt).not.toBeNull();

    // 4. The first win made an account.
    await openHeaderMenu(page);
    await expect(page.locator('[data-header-account]')).toHaveText(/^@\S+$/);

    // 5. "Collect for me" on, from the game panel.
    const panel = await openGamePanel(page);
    const collect = panel.getByTestId('game-collect');
    await collect.click();
    await expect(collect).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await closeHeaderMenu(page);

    // 6. Start: the first run, at the same address, the map box focused and in its run view.
    await start.click();
    expect(new URL(page.url()).pathname).toBe('/');
    await expect.poll(() => focusHoldsMap(page)).toBe(true);
    await waitPhase(page, 'run');
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-run-view', 'on');
    await waitPhase(page, 'tally');
    expect(new URL(page.url()).pathname).toBe('/');

    // 7. The settled run: everything dropped was collected, rung 0 met with its lump.
    const s = await waitSaved(page, (g) => g.state.runs === 1);
    expect(s.state.phase).toBe('runs');
    expect(s.state.last!.dropped.home).toBeGreaterThan(0);
    expect(s.state.last!.collected.home).toBe(s.state.last!.dropped.home);
    expect(s.state.met.map((m) => m.rung)).toContain(0);
    expect(s.state.last!.lump).toEqual(RUNG_LUMP);
    expect(s.state.units.home).toBe(
      s.state.last!.collected.home! +
        RUNG_LUMP.home! +
        s.state.last!.side.reduce((n, x) => n + (x.reward.home ?? 0), 0)
    );

    // 8. The run layer's totals are the saved ones; the tally shows the lump.
    expect(await runTotals(page)).toEqual({
      dropped: s.state.last!.dropped.home,
      collected: s.state.last!.collected.home
    });
    await expect(page.getByTestId('tally-lump')).toBeVisible();

    // 9. Continue: the tree, with Run and the next goal; the map out of its run view.
    await page.getByTestId('tally-continue').click();
    await waitPhase(page, 'tree');
    await expect(page.getByTestId('tree-run')).toBeVisible();
    await expect(page.getByTestId('tree-next')).toBeVisible();
    await expect(page.getByTestId('map-root')).not.toHaveAttribute('data-run-view');

    // 10. Buy the first node the balance covers.
    await expect(readyNodes(page).first()).toBeVisible();
    const id = await firstReady(page);
    const before = await savedGame(page);
    const after = await buyNode(page, id, 'pointer');
    expect(after.state.bought[id]).toBe(1);
    expect(after.state.units.home).toBe(before.state.units.home! - PRICES[id][0]);

    // 11. Its Edit opens the workshop; Back to the tree returns.
    await node(page, id).getByTestId('tree-node-edit').click();
    await waitPhase(page, 'workshop');
    await waitFilled(page);
    await (await headerAction(page, 'Back to the tree')).click();
    await waitPhase(page, 'tree');

    // 12. A second run.
    await page.getByTestId('tree-run').click();
    await waitPhase(page, 'tally');
    const second = await waitSaved(page, (g) => g.state.runs === 2);
    expect(second.state.runs).toBe(2);
    await page.getByTestId('tally-continue').click();
    await waitPhase(page, 'tree');

    // 13. Take the next goal: rung 1, and the header's goal changes.
    const headline = page.getByTestId('goal-headline-button');
    const was = (await headline.textContent()) ?? '';
    await page.getByTestId('tree-next').click();
    const next = await waitSaved(page, (g) => g.state.rung === 1);
    expect(next.state.rung).toBe(1);
    await expect.poll(async () => (await headline.textContent()) ?? '').not.toBe(was);

    // 14. The account holds the one game, at rung 1.
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/game');
        if (res.status() !== 200) return { status: res.status() };
        const body = (await res.json()) as { saves: { phase: string; rung: number }[] };
        return {
          status: 200,
          saves: body.saves.map((e) => ({ phase: e.phase, rung: e.rung }))
        };
      })
      .toEqual({ status: 200, saves: [{ phase: 'runs', rung: 1 }] });
  });
});

test('a player plays the loop by keyboard only, collecting with the ring', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'the keyboard journey runs on the desktop project');

  // 1. A goal any stamp reaches, a run long enough to sweep, Paint at the fixture's frame.
  await seedGoalAmount(page, 1);
  await seedRunMs(page, 8000);
  await gotoEditor(page);
  await jumpAndIdle(page, FRAME);

  // 2. Tab to the map and stamp with Enter. (No click, tap, mouse or touchscreen from here on.)
  await page.locator('body').focus();
  const canvas = page.locator('.maplibregl-canvas');
  await tabTo(page, canvas);
  expect(await focusVisible(canvas)).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => ops(page)).toBe(1);

  // 3. Start by Enter: the map box takes focus and the run starts.
  const start = page.getByTestId('opening-start');
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => focusHoldsMap(page)).toBe(true);
  await waitPhase(page, 'run');

  // 4. The ring, swept by the arrow keys, collects.
  expect(await sweepRing(page)).toBeGreaterThanOrEqual(1);

  // 5. The tally: "Collect for me" was never set, so what was collected is the ring's. The run
  // goes on for the rest of its 8 s after the first catch, longer than an `expect`'s wait: this
  // one is bounded by the test's.
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tl-mode"]')?.getAttribute('data-phase') === 'tally'
  );
  await waitPhase(page, 'tally');
  const s = await waitSaved(page, (g) => g.state.runs === 1);
  expect(s.state.last!.collected.home).toBeGreaterThanOrEqual(1);

  // 6. Continue by Enter: the tree, with Run focused.
  const cont = page.getByTestId('tally-continue');
  await expect(cont).toBeFocused();
  await page.keyboard.press('Enter');
  await waitPhase(page, 'tree');
  await expect(page.getByTestId('tree-run')).toBeFocused();

  // 7. Buy the first node the balance covers, by keys.
  await expect(readyNodes(page).first()).toBeVisible();
  const id = await firstReady(page);
  const bought = await buyNode(page, id, 'keys');
  expect(bought.state.bought[id]).toBe(1);

  // 8. Its Edit into the workshop, Back to the tree out.
  const edit = node(page, id).getByTestId('tree-node-edit');
  await tabTo(page, edit);
  expect(await focusVisible(edit)).toBe(true);
  await page.keyboard.press('Enter');
  await waitPhase(page, 'workshop');
  const back = page.getByTestId('game-back');
  await tabTo(page, back);
  expect(await focusVisible(back)).toBe(true);
  await page.keyboard.press('Enter');
  await waitPhase(page, 'tree');

  // 9. Take the next goal.
  const next = page.getByTestId('tree-next');
  await tabTo(page, next);
  expect(await focusVisible(next)).toBe(true);
  await page.keyboard.press('Enter');
  const taken = await waitSaved(page, (g) => g.state.rung === 1);
  expect(taken.state.rung).toBe(1);
});

/** The number of rungs: one per deadline year, and the window's end. */
const RUNGS = LADDER_YEARS.length + 1;

/** fixture-0's today (`asOf` in its calibration). */
const ASOF = (
  JSON.parse(
    readFileSync(
      new URL('./fixtures/data/fixture-0/scenarios/fzp/calibration.json', import.meta.url),
      'utf8'
    )
  ) as { asOf: number }
).asOf;

/**
 * Steps 1 to 5 of the ending: every rung but the last met (each on the fixture's today), nothing
 * bought, one run, and the ending in the tree. Returns the ending.
 */
async function reachTheEnding(page: Page): Promise<Locator> {
  // 1. Every rung but the last met.
  const met: MetRung[] = Array.from({ length: RUNGS - 1 }, (_, k) => ({
    rung: k,
    reachedOn: ASOF,
    datasetVersion: 'fixture-0',
    at: new Date().toISOString()
  }));

  // 2. The tree at the last rung: no next goal, no ending yet.
  await seedGame(page, { phase: 'runs', runs: 1, rung: RUNGS - 1, met });
  await seedGoalAmount(page, 1);
  await seedRunMs(page, 2000);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await expect(page.getByTestId('tree-next')).toHaveCount(0);
  await expect(page.getByTestId('tree-ending')).toHaveCount(0);

  // 3. A run.
  await page.getByTestId('tree-run').click();
  await waitPhase(page, 'tally');
  await page.getByTestId('tally-continue').click();
  await waitPhase(page, 'tree');

  // 4. The last rung met.
  expect((await savedGame(page)).state.met.map((m) => m.rung)).toContain(RUNGS - 1);

  // 5. The ending: its months, no node listed (nothing is bought), no next goal.
  const ending = page.getByTestId('tree-ending');
  await expect(ending).toContainText('Every goal met');
  await expect(ending).toContainText(/Reached in [A-Z][a-z]{2} \d{4}/);
  await expect(ending).toContainText(/The state asks by [A-Z][a-z]{2} \d{4}/);
  await expect(ending.locator('li')).toHaveCount(0);
  await expect(page.getByTestId('tree-next')).toHaveCount(0);
  return ending;
}

test('meeting the last deadline is the ending', async ({ page }) => {
  const ending = await reachTheEnding(page);
  await expect(ending.getByTestId('tree-publish')).toBeVisible();
});

test("the ending's Publish opens the publish dialog", async ({ page }) => {
  // Known gap: with nothing bought the policy is empty, the header's Publish is aria-disabled
  // ("Change the policy first.", PublishButton.svelte:44,60), and the tree's Publish only presses
  // it (SimPage.svelte:689-698), so no dialog opens. Remove this line once that is fixed.
  test.fail(true, 'the tree Publish presses the disabled header Publish when nothing is bought');
  await reachTheEnding(page);
  // 6. Its Publish opens the publish dialog.
  await page.getByTestId('tree-publish').click();
  await expect(policyPublishDialog(page)).toBeVisible();
});
