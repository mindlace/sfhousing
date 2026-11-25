// Playing the game from a spec: the saved game, the phase, the run layer and its ring, the tree.
// Every wait is a state in the page or in storage (`data-phase`, `data-state`, the saved game);
// none is a fixed time.
import { expect, type Locator, type Page } from '@playwright/test';
import type { GameSave } from '../../src/lib/game/save-shape';
import { SAVES_KEY, saveKey } from '../../src/lib/game/saves';
import { RING_KEYS } from '../../src/lib/game/run/run-model';
import type { GamePhase } from '../../src/lib/sim-page/game-phase';
import { openHeaderMenu } from './sharing';

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

/** Polls `savedGame` until `ok` holds; returns that save. */
export async function waitSaved(page: Page, ok: (s: GameSave) => boolean): Promise<GameSave> {
  let last: GameSave | null = null;
  await expect
    .poll(async () => {
      try {
        last = await savedGame(page);
      } catch {
        return false;
      }
      return ok(last);
    })
    .toBe(true);
  return last!;
}

/** Waits until the timeline's `data-phase` is `p`. */
export async function waitPhase(page: Page, p: GamePhase): Promise<void> {
  await expect(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', p);
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
 * Sweeps the ring over the whole run layer with Shift+Arrow keys, row after row, until a drop is
 * collected or the run ends; returns `data-collected`. The ring starts at the box's centre: it
 * goes to the top left first, then crosses the box row by row (Shift+ArrowRight or ArrowLeft to
 * the edge, one Shift+ArrowDown, and back), turning up again at the bottom. A Shift step is 64 px
 * and the ring's radius at least 48 px, so rows 64 px apart cover the box.
 */
export async function sweepRing(page: Page): Promise<number> {
  const layer = runLayer(page);
  const box = await layer.boundingBox();
  if (!box) throw new Error('sweepRing: the run layer has no box');
  const step = RING_KEYS.shiftStepPx;
  const cols = Math.ceil(box.width / step);
  const rows = Math.ceil(box.height / step);
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

  await press('ArrowLeft', Math.ceil(cols / 2));
  await press('ArrowUp', Math.ceil(rows / 2));
  let across = 'ArrowRight';
  let down = 'ArrowDown';
  let row = 0;
  while (keys < MAX_KEYS) {
    await press(across, cols);
    across = across === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    if (await done()) break;
    await press(down, 1);
    row++;
    if (row >= rows) {
      row = 0;
      down = down === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown';
    }
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
