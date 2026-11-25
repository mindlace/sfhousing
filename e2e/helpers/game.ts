import type { Page } from '@playwright/test';
import { newId } from '../../src/lib/ids/base58';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from '../../src/lib/game/e2e';
import { E2E_RUN_MS_KEY } from '../../src/lib/sim-page/e2e-run';
import { SAVES_KEY, saveKey } from '../../src/lib/game/saves';
import { NEW_GAME, type GameState } from '../../src/lib/game/state';
import type { GameSave } from '../../src/lib/game/save-shape';

const seeded = new WeakSet<Page>();

/** Before the page loads, switch the real game on and store a v2 game: the new game with `state` over it. */
export async function seedGame(page: Page, state?: Partial<GameState>): Promise<void> {
  if (seeded.has(page)) throw new Error('seedGame: this page already has a game');
  seeded.add(page);

  const id = newId();
  const at = new Date().toISOString();
  const merged: GameState = { ...NEW_GAME, ...state, v: 2 };
  if (state?.firstWinAt === undefined && merged.phase === 'runs') merged.firstWinAt = at;

  const save: GameSave = {
    v: 2,
    id,
    name: 'Seeded game',
    nameIsDefault: false,
    state: merged,
    plan: null,
    policy: null,
    savedAt: at
  };
  const index = {
    v: 2,
    current: id,
    saves: [
      {
        id,
        name: 'Seeded game',
        nameIsDefault: false,
        savedAt: at,
        phase: merged.phase,
        rung: merged.rung
      }
    ]
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

/** Before the page loads, set the wall time of a run (100 to 20,000 ms) for this page. */
export async function seedRunMs(page: Page, ms: number): Promise<void> {
  if (!Number.isSafeInteger(ms) || ms < 100 || ms > 20000)
    throw new Error('seedRunMs: ms must be a whole number from 100 to 20000');
  await page.addInitScript(
    (a) => {
      try {
        localStorage.setItem(a.key, a.value);
      } catch {
        // storage refused: the page still loads
      }
    },
    { key: E2E_RUN_MS_KEY, value: String(ms) }
  );
}
