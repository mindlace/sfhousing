import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { newId } from '../../src/lib/ids/base58';
import { MONTH_DAYS } from '../../src/lib/timelapse/time';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from '../../src/lib/game/e2e';
import { SAVES_KEY, saveKey, type GameSave } from '../../src/lib/game/saves';
import type { Banked } from '../../src/lib/game/progress';

/** The fixture's window: WINDOW_MONTHS in src/lib/sim/timeline-client.ts. */
const WINDOW_MONTHS = 480;
const asOf: number = JSON.parse(
  readFileSync(
    new URL('../fixtures/data/fixture-0/scenarios/fzp/calibration.json', import.meta.url),
    'utf8'
  )
).asOf;
const end = new Date((asOf + Math.floor(WINDOW_MONTHS * MONTH_DAYS)) * 86_400_000);
/** The first day of the calendar month that holds the window's last day: 35337 on the fixture. */
export const SEED_BAR_DAY = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1) / 86_400_000;

const seeded = new WeakSet<Page>();

/** Before the page loads, switch the real game on and store a game at `level` with bars that any result beats. */
export async function seedGame(page: Page, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
  if (seeded.has(page)) throw new Error('seedGame: this page already has a game');
  if (![1, 2, 3, 4, 5].includes(level)) throw new Error('seedGame: level must be 1 to 5');
  seeded.add(page);

  const id = newId();
  const at = new Date().toISOString();
  const banked: Record<number, Banked> = {};
  for (let n = 2; n < level; n++) banked[n] = { on: SEED_BAR_DAY, datasetVersion: 'fixture-0', at };

  const save: GameSave = {
    v: 1,
    id,
    name: 'Seeded game',
    nameIsDefault: false,
    progress: { v: 1, level, banked, firstWinAt: level > 1 ? at : null },
    plan: null,
    policy: null,
    savedAt: at
  };
  const index = {
    v: 1,
    current: id,
    saves: [{ id, name: 'Seeded game', nameIsDefault: false, savedAt: at, level }]
  };

  await page.addInitScript(
    (a) => {
      try {
        localStorage.setItem(a.gameKey, '1');
        if (localStorage.getItem(a.savesKey) === null) {
          localStorage.setItem(a.key, a.save);
          localStorage.setItem(a.savesKey, a.index);
        }
      } catch {
        // storage refused: write nothing more, so the page still loads
      }
    },
    {
      gameKey: E2E_GAME_KEY,
      savesKey: SAVES_KEY,
      key: saveKey(id),
      save: JSON.stringify(save),
      index: JSON.stringify(index)
    }
  );
}

/** Before the page loads, switch the real game on with nothing stored: a new visitor. */
export async function newVisitor(page: Page): Promise<void> {
  if (seeded.has(page)) throw new Error('newVisitor: this page already has a game');
  seeded.add(page);
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // storage refused: the page still loads
    }
  }, E2E_GAME_KEY);
}

/** Before the page loads, set the goal's amount for this page. */
export async function seedGoalAmount(page: Page, amount: number): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new Error('seedGoalAmount: amount must be a whole number of at least 1');
  await page.addInitScript(
    (a) => {
      try {
        localStorage.setItem(a.key, a.value);
      } catch {
        // storage refused: the page still loads
      }
    },
    { key: E2E_GOAL_KEY, value: String(amount) }
  );
}
