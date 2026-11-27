// Playing the game from a spec: the saved game and the simulation tool. Every wait is a state in
// the page or in storage (the tool's dock, `data-state`, the saved game); none is a fixed time.
import { expect, type Locator, type Page } from '@playwright/test';
import type { GameSave } from '../../src/lib/game/save-shape';
import { SAVES_KEY, saveKey } from '../../src/lib/game/saves';
import type { GameState } from '../../src/lib/game/state';
import { seedGame, seedGoalAmount } from './game';
import { openHeaderMenu } from './sharing';

/**
 * Before the first load: the goal amount 1 and a game seeded with `state` (default: in the runs
 * with one run settled).
 */
export async function seedRuns(
  page: Page,
  state: Partial<GameState> = { phase: 'runs', runs: 1 }
): Promise<void> {
  await seedGoalAmount(page, 1);
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

/** Waits until the page is the simulation tool: its dock (the timeline) is visible. */
export async function waitSim(page: Page): Promise<void> {
  await expect(page.getByTestId('tl-dock')).toBeVisible();
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

/** Opens the header's Menu, which holds the game panel; returns the panel. */
export async function openGamePanel(page: Page): Promise<Locator> {
  await openHeaderMenu(page);
  const panel = page.getByTestId('game-panel');
  await expect(panel).toBeVisible();
  return panel;
}
