// The game's journey across units (closing spec, sec-design-journey and sec-design-measure): a new
// visitor wins Paint, levels up onto /sim, wins level 2, levels up to 3 and finds the game on the
// account; and a given measure added at a later month has its money dated from that month. Runs
// against the VITE_E2E build on fixture-0, with the real game switched on by e2e/helpers/game.ts
// before the first navigation; every wait is on the page or `window.__sfhFzp`, never on time.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { E2E_GOAL_KEY } from '../src/lib/game/e2e';
import type { Day } from '../src/lib/timelapse/time';
import type { Inflow } from '../src/lib/timelapse/types';
import type { Effect } from '../src/lib/timeline/policy4';
import { PLUS_NAME } from '../src/lib/timeline/test/plus';
import { expectNoA11yViolations } from './helpers/a11y';
import { newVisitor, seedGame, seedGoalAmount } from './helpers/game';
import { addPolicy, openKind, slider, waitFilled } from './helpers/run';
import { gotoEditor, gotoHydrated, paintOnce } from './helpers/sharing';

// Any stroke that adds a home wins Paint.
const PAINT_AMOUNT = 1;
// Homes current law reaches on fixture-0 at month 60: goal.measure.valueAt(run.view, 60)
// on runEmptyDocument('e2e/fixtures/data/fixture-0'), goal = defaultGoal(run.asOf).
const SIM_AMOUNT = 415;

const BOND = 'A housing bond';
const MONTH = /Goal reached in ([A-Z][a-z]{2} \d{4})/;
const KINDS = ['Zoning', 'Permitting', 'Public money'] as const;

type JourneyWin = Window & { __sfhFzp?: SfhFzpDebug; __journey?: true };

const fzp = <K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> =>
  page.evaluate((k) => (window as JourneyWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;

const timeline = (page: Page): Locator => page.getByTestId('tl-timeline');
const simWin = (page: Page): Locator => page.getByTestId('tl-win');
const levelCell = (page: Page): Locator => page.getByTestId('header-level');
const lockedLane = (page: Page, kind: string): Locator =>
  page.getByTestId(`tl-kind-${kind}`).getByTestId('tl-locked-lane').first();

/** /sim's session ready and its forecast filled to the window's end. */
async function simReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as JourneyWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

/**
 * Below lg, opens the header's Menu by `[data-header-menu]`, which matches whatever its name
 * ("Menu, level up ready" while an offer is set); from lg, does nothing.
 */
async function openMenu(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  const menu = page.locator('[data-header-menu]');
  if (!(await menu.isVisible())) return;
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
}

/** "10 Dec 2030": a span edge as the bar's name writes it (rows.ts `formatEdge`). */
function edgeText(day: Day): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    })
      .formatToParts(new Date(day * 86_400_000))
      .map((x) => [x.type, x.value])
  );
  return `${p.day} ${p.month} ${p.year}`;
}

/** The day an inflow's money first arrives. */
const inflowDay = (i: Inflow): Day => (i.kind === 'once' ? i.day : i.from);

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('a new visitor wins Paint and level 2, levels up to 3, and the account holds the game', async ({
  page,
  context,
  isMobile
}) => {
  // 1. A new visitor whose goal any stroke reaches, on Paint.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await newVisitor(page);
  await seedGoalAmount(page, PAINT_AMOUNT);
  await gotoEditor(page);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');

  // 2. Level 1, and Simulate is no link.
  await expect(levelCell(page)).toHaveText('Level 1');
  await expect(page.locator('[data-step-locked]').first()).toBeAttached();
  await expect(page.getByRole('link', { name: 'Simulate' })).toHaveCount(0);

  // 3. One stroke wins Paint: the header says so and the card offers the simulation.
  await paintOnce(page, isMobile);
  // The header's second line, which also describes the score (shown from sm, sr-only always).
  await expect(page.getByRole('banner').getByTestId('score-bar')).toHaveAccessibleDescription(
    /Goal reached/
  );
  const paintCard = page.getByTestId('paint-win');
  await expect(paintCard).toContainText('Unlocks: The simulation');
  await expect(paintCard.getByRole('button', { name: 'Level up' })).toBeVisible();
  await expect(paintCard.getByRole('button', { name: 'Keep playing' })).toBeVisible();

  // 4. /sim's goal, then Level up: a client navigation (the mark survives) to /sim at level 2.
  await page.evaluate((a) => localStorage.setItem(a.key, a.value), {
    key: E2E_GOAL_KEY,
    value: String(SIM_AMOUNT)
  });
  await page.evaluate(() => ((window as JourneyWin).__journey = true));
  await paintCard.getByRole('button', { name: 'Level up' }).click();
  await expect(page).toHaveURL(/\/sim$/);
  expect(await page.evaluate(() => (window as JourneyWin).__journey)).toBe(true);
  await expect(levelCell(page)).toHaveText('Level 2');
  await simReady(page);
  for (const kind of KINDS) {
    await expect(timeline(page).getByRole('button', { name: PLUS_NAME[kind] })).toHaveCount(0);
  }

  // 5. Play to the goal: the card names the month and Permitting.
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect(simWin(page)).toContainText('Goal reached in');
  const month = MONTH.exec((await simWin(page).textContent()) ?? '')?.[1];
  expect(month, 'the win card names a month').toBeDefined();
  await expect(simWin(page)).toContainText('Unlocks: Permitting');

  // 6. Level up: level 3, the clock at today, Permitting open to edit, the rest locked.
  await simWin(page).getByRole('button', { name: 'Level up' }).click();
  await expect(simWin(page)).toHaveCount(0);
  await expect(levelCell(page)).toHaveText('Level 3');
  await expect.poll(async () => (await fzp(page, 'day')) === (await fzp(page, 'asOf'))).toBe(true);
  await expect(
    timeline(page).getByRole('button', { name: PLUS_NAME.Permitting }).last()
  ).toBeVisible();
  await expect(lockedLane(page, 'zoning')).toHaveText('Unlocks when you level up');
  await expect(lockedLane(page, 'money')).toHaveText('Unlocks at level 5');

  // 7. The bar: the level panel's aim and the ruler's flag.
  await openMenu(page);
  await levelCell(page).click();
  await expect(page.getByTestId('header-level-panel').getByTestId('level-aim')).toHaveText(
    `Beat ${month}`
  );
  await levelCell(page).click();
  await expect(page.getByTestId('header-level-panel')).toHaveCount(0);
  await expect(page.getByTestId('tl-bar-flag')).toHaveText(/To beat/);

  // 8. The account the first win's save made shows as @handle, with no reload and the playhead kept.
  const day = await fzp(page, 'day');
  await expect(page.locator('[data-header-account]')).toHaveText(/^@\S+$/);
  expect(await page.evaluate(() => (window as JourneyWin).__journey)).toBe(true);
  expect(await fzp(page, 'day')).toBe(day);

  // 9. The account holds one game, at level 3 once the level up's save lands.
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/game');
      if (res.status() !== 200) return { status: res.status() };
      const body = (await res.json()) as { saves: { level: number }[] };
      return { status: 200, levels: body.saves.map((s) => s.level) };
    })
    .toEqual({ status: 200, levels: [3] });

  // 10. "Reload /sim", read as a fresh load of /sim in the same context: the page's init script
  // from step 1 would write Paint's goal amount again on a reload, and a fresh page has none. The
  // context's storage and cookies are the game's and the account's, as on a reload.
  await page.close();
  const again = await context.newPage();
  await again.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(again, '/sim');
  expect(await again.evaluate((k) => localStorage.getItem(k), E2E_GOAL_KEY)).toBe(
    String(SIM_AMOUNT)
  );
  await simReady(again);
  await expect(levelCell(again)).toHaveText('Level 3');
  await expect(again.getByTestId('tl-bar-flag')).toHaveText(/To beat/);

  // 11. No axe violations at level 3 with the card closed.
  await expect(simWin(again)).toHaveCount(0);
  await expectNoA11yViolations(again);
});

test('a given measure added at a later month has its money dated from that month', async ({
  page
}) => {
  // 1. Level 5, /sim filled.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedGame(page, 5);
  await gotoHydrated(page, '/sim');
  await simReady(page);
  const asOf = await fzp(page, 'asOf');

  // 2. Three years on, a year per key (PageUp moves the playhead forward a year).
  await page.getByTestId('tl-ruler').focus();
  for (let i = 0; i < 3; i++) {
    const before = await fzp(page, 'day');
    await page.keyboard.press('PageUp');
    await expect.poll(() => fzp(page, 'day')).toBeGreaterThan(before);
  }
  const day = await fzp(page, 'day');

  // 3. Public money's "+", A housing bond.
  await openKind(page, 'Public money');
  await addPolicy(page, 'Public money', BOND);

  // 4. The document once the numbers are current.
  await page.waitForFunction(() => (window as JourneyWin).__sfhFzp?.stale === false);
  const policy = await fzp(page, 'policy');
  const bond = policy.kinds.money.find((p) => p.preset === 'housing-bond');
  expect(bond, 'the document holds the housing bond').toBeDefined();

  // Its first span starts in the playhead's model month, more than two years after today.
  const start = bond!.spans[0].from;
  expect(start).toBeLessThanOrEqual(day);
  expect(day - start).toBeLessThanOrEqual(31);
  expect(start - asOf).toBeGreaterThan(2 * 365);

  // Its pool's first money-in falls on that start.
  const what = bond!.spans[0].what;
  expect(what.tag).toBe('fund');
  const pool = (what as Extract<Effect, { tag: 'fund' }>).pool;
  expect(pool, 'the bond has a pool').not.toBeNull();
  expect(Math.min(...pool!.inflows.map(inflowDay))).toBe(start);

  // Its label and preset.
  expect(bond!.label).toBe(BOND);
  expect(bond!.preset).toBe('housing-bond');

  // The bar on the Public money row is named with the label and the start date.
  await expect(
    page.getByTestId('tl-kind-money').getByRole('button', {
      name: new RegExp(`, ${escape(BOND)}, ${escape(edgeText(start))} to `)
    })
  ).not.toHaveCount(0);
});
