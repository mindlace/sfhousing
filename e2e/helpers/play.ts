// Playing the game from a spec: the saved game, the phase, the run layer and its ring, the tree.
// Every wait is a state in the page or in storage (`data-phase`, `data-state`, the saved game);
// none is a fixed time.
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import type { GameSave } from '../../src/lib/game/save-shape';
import { SAVES_KEY, saveKey } from '../../src/lib/game/saves';
import { RING_KEYS } from '../../src/lib/game/run/run-model';
import { LADDER_YEARS } from '../../src/lib/game/catalogue/ladder-years';
import { PRICES } from '../../src/lib/game/catalogue/tuning';
import type { GamePhase } from '../../src/lib/sim-page/game-phase';
import type { GameState, MetRung } from '../../src/lib/game/state';
import { seedGame, seedGoalAmount, seedRunMs } from './game';
import { gotoHydrated, openHeaderMenu } from './sharing';

/**
 * Before the first load: the goal amount 1, a run of 2,000 ms and a game seeded with `state`
 * (default: in the runs with one run settled, so the page lands on the tree).
 */
export async function seedRuns(
  page: Page,
  state: Partial<GameState> = { phase: 'runs', runs: 1 }
): Promise<void> {
  await seedGoalAmount(page, 1);
  await seedRunMs(page, 2000);
  await seedGame(page, state);
}

/** The current game as storage holds it; throws when there is none. */
export async function savedGame(page: Page): Promise<GameSave> {
  const index = await page.evaluate((k) => localStorage.getItem(k), SAVES_KEY);
  if (index === null) throw new Error('savedGame: no saved games');
  const current = (JSON.parse(index) as { current?: unknown }).current;
  if (typeof current !== 'string') throw new Error('savedGame: no current game');
  const text = await page.evaluate((k) => localStorage.getItem(k), saveKey(current));
  if (text === null) throw new Error(`savedGame: no save for ${current}`);
  return JSON.parse(text) as GameSave;
}

/** Polls `savedGame` every 50 ms (no back-off) until `ok` holds; returns that save. */
export async function waitSaved(page: Page, ok: (s: GameSave) => boolean): Promise<GameSave> {
  let last: GameSave | null = null;
  await expect
    .poll(
      async () => {
        try {
          last = await savedGame(page);
        } catch {
          return false;
        }
        return ok(last);
      },
      { intervals: [50] }
    )
    .toBe(true);
  return last!;
}

/** Waits until the timeline's `data-phase` is `p`. */
export async function waitPhase(page: Page, p: GamePhase): Promise<void> {
  await expect(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', p);
}

/**
 * `waitPhase`, for a phase after a press of Start, Run or a run's end: getting the forecast ready
 * (starting) and the run itself can together outlast an `expect`'s window, so the wait is bounded
 * by the test's (a page function, checked each frame), then `waitPhase` confirms it.
 */
export async function untilPhase(page: Page, p: 'run' | 'tally'): Promise<void> {
  await page.waitForFunction(
    (want) =>
      document.querySelector('[data-testid="tl-mode"]')?.getAttribute('data-phase') === want,
    p
  );
  await waitPhase(page, p);
}

/** The number of rungs: one per deadline year, and the window's end. */
export const RUNGS = LADDER_YEARS.length + 1;

/** fixture-0's today (`asOf` in its calibration). */
const ASOF = (
  JSON.parse(
    readFileSync(
      new URL('../fixtures/data/fixture-0/scenarios/fzp/calibration.json', import.meta.url),
      'utf8'
    )
  ) as { asOf: number }
).asOf;

/**
 * The ending, as journey 3 reaches it (closing spec, sec-design-ending steps 1 to 3): every rung
 * but the last met and stop-rail's price in hand, the tree at the last rung (no next goal, no
 * ending yet), stop-rail bought by pointer, one run, Continue. Leaves the page on the tree showing
 * the ending; returns the label of stop-rail's card (its `tree-node-open`'s first line).
 */
export async function playToEnding(page: Page): Promise<string> {
  const met: MetRung[] = Array.from({ length: RUNGS - 1 }, (_, k) => ({
    rung: k,
    reachedOn: ASOF,
    datasetVersion: 'fixture-0',
    at: new Date().toISOString()
  }));
  await seedGame(page, {
    phase: 'runs',
    runs: 1,
    rung: RUNGS - 1,
    met,
    units: { home: PRICES['stop-rail'][0] }
  });
  await seedGoalAmount(page, 1);
  await seedRunMs(page, 2000);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await expect(page.getByTestId('tree-next')).toHaveCount(0);
  await expect(page.getByTestId('tree-ending')).toHaveCount(0);
  const rail = page.locator('[data-testid="tree-node"][data-node="stop-rail"]');
  await expect(rail).toHaveAttribute('data-state', 'ready');
  const bought = await buyNode(page, 'stop-rail', 'pointer');
  expect(bought.state.bought['stop-rail']).toBe(1);
  const label = (
    (await rail.getByTestId('tree-node-open').first().locator('span').first().textContent()) ?? ''
  ).trim();
  expect(label).not.toBe('');
  // A run (it waits for the forecast with the bought rule first), then Continue.
  await page.getByTestId('tree-run').click();
  await untilPhase(page, 'tally');
  await page.getByTestId('tally-continue').click();
  await waitPhase(page, 'tree');
  return label;
}

/** The run layer. */
export function runLayer(page: Page): Locator {
  return page.getByTestId('run-layer');
}

/** The run layer's `data-dropped` and `data-collected`. */
export async function runTotals(page: Page): Promise<{ dropped: number; collected: number }> {
  const layer = runLayer(page);
  return {
    dropped: Number(await layer.getAttribute('data-dropped')),
    collected: Number(await layer.getAttribute('data-collected'))
  };
}

const focused = (target: Locator): Promise<boolean> =>
  target.evaluate((el) => el === document.activeElement);

/** Presses Tab, at most 80 times, until `target` has focus; throws otherwise. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  if (await focused(target)) return;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await focused(target)) return;
  }
  throw new Error('tabTo: target not reached in 80 presses');
}

const MAX_KEYS = 3000;

/**
 * Sweeps the ring over the run layer with Shift+Arrow keys until a drop is collected or the run
 * ends; returns `data-collected`. It waits for the layer to be running first (the phase can show
 * `run` a frame before the layer does). The ring starts at the box's centre, and the run view
 * frames the city, so drops near the middle are found first: a square spiral out from the centre
 * (legs of 1, 1, 2, 2, 3, 3 ... steps, turning clockwise) until it spans the box, then back to the
 * centre (to the top left corner, where the ring stops, and halfway back) and again. A Shift step
 * is 64 px and the ring's radius at least 48 px, so legs 64 px apart cover the box.
 */
export async function sweepRing(page: Page): Promise<number> {
  const layer = runLayer(page);
  await expect(layer).toHaveAttribute('data-state', 'running');
  const box = await layer.boundingBox();
  if (!box) throw new Error('sweepRing: the run layer has no box');
  const step = RING_KEYS.shiftStepPx;
  const cols = Math.ceil(box.width / step);
  const rows = Math.ceil(box.height / step);
  const reach = Math.max(cols, rows);
  let keys = 0;
  const press = async (key: string, times: number): Promise<void> => {
    for (let i = 0; i < times && keys < MAX_KEYS; i++) {
      await page.keyboard.press(`Shift+${key}`);
      keys++;
    }
  };
  const done = async (): Promise<boolean> => {
    if ((await runTotals(page)).collected >= 1) return true;
    return (await layer.getAttribute('data-state')) === 'idle';
  };

  const turns = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  while (keys < MAX_KEYS) {
    for (let leg = 0; leg < 2 * reach && keys < MAX_KEYS; leg++) {
      await press(turns[leg % 4], Math.floor(leg / 2) + 1);
      if (await done()) return (await runTotals(page)).collected;
    }
    await press('ArrowLeft', cols);
    await press('ArrowUp', rows);
    await press('ArrowRight', Math.floor(cols / 2));
    await press('ArrowDown', Math.floor(rows / 2));
    if (await done()) break;
  }
  return (await runTotals(page)).collected;
}

/**
 * Opens node `id` and presses its Buy, by pointer or by keys; waits until the save shows the
 * node's level one higher and returns that save.
 */
export async function buyNode(page: Page, id: string, by: 'pointer' | 'keys'): Promise<GameSave> {
  const before = (await savedGame(page)).state.bought[id] ?? 0;
  const open = page
    .locator(`[data-testid="tree-node"][data-node="${id}"]`)
    .getByTestId('tree-node-open')
    .first();
  const buy = page.getByTestId('tree-detail').getByTestId('tree-buy');
  if (by === 'pointer') {
    await open.click();
    await buy.click();
  } else {
    await tabTo(page, open);
    await page.keyboard.press('Enter');
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await tabTo(page, buy);
    await page.keyboard.press('Enter');
  }
  return waitSaved(page, (s) => (s.state.bought[id] ?? 0) === before + 1);
}

/** The `data-node` of the first tree node whose `data-state` is `ready`; throws when none is. */
export async function firstReady(page: Page): Promise<string> {
  const ready = page.locator('[data-testid="tree-node"][data-state="ready"]');
  if ((await ready.count()) === 0) throw new Error('firstReady: no ready node');
  return (await ready.first().getAttribute('data-node'))!;
}

/** Opens the game panel from the unit count (the Menu first below lg); returns the panel. */
export async function openGamePanel(page: Page): Promise<Locator> {
  await openHeaderMenu(page);
  const units = page.getByTestId('header-units');
  if ((await units.getAttribute('aria-expanded')) !== 'true') await units.click();
  const panel = page.getByTestId('game-panel');
  await expect(panel).toBeVisible();
  return panel;
}
