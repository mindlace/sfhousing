import { expect, test, type Page } from '@playwright/test';
import { newVisitor, seedGame, seedGoalAmount, seedRunMs } from './helpers/game';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from '../src/lib/game/e2e';
import { E2E_RUN_MS_KEY } from '../src/lib/sim-page/e2e-run';
import { SAVES_KEY, saveKey } from '../src/lib/game/saves';

type Probe = Record<string, string>;

/** Registered after the helpers' scripts: copies the game's keys before the page's scripts run. */
async function probe(page: Page): Promise<void> {
  await page.addInitScript(
    (k) => {
      const out: Record<string, string> = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key === null) continue;
          if (
            key === k.game ||
            key === k.goal ||
            key === k.runMs ||
            key === k.saves ||
            key.startsWith(k.prefix)
          )
            out[key] = localStorage.getItem(key) ?? '';
        }
      } catch {
        // storage refused: the probe stays empty
      }
      (window as unknown as { __gameProbe: Record<string, string> }).__gameProbe = out;
    },
    {
      game: E2E_GAME_KEY,
      goal: E2E_GOAL_KEY,
      runMs: E2E_RUN_MS_KEY,
      saves: SAVES_KEY,
      prefix: saveKey('')
    }
  );
}

async function read(page: Page): Promise<Probe> {
  return page.evaluate(
    () => (window as unknown as { __gameProbe: Record<string, string> }).__gameProbe
  );
}

async function load(page: Page): Promise<Probe> {
  await probe(page);
  await page.goto('/about');
  return read(page);
}

type Saved = {
  v: number;
  id: string;
  state: { phase: string; rung: number; firstWinAt: string | null; units: { home?: number } };
};

function seededParts(p: Probe): {
  index: { v: number; current: string; saves: { id: string; phase: string; rung: number }[] };
  save: Saved;
} {
  const index = JSON.parse(p[SAVES_KEY]);
  const save = JSON.parse(p[saveKey(index.current)]);
  return { index, save };
}

test('with no helper, nothing is stored', async ({ page }) => {
  const p = await load(page);
  expect(p[E2E_GAME_KEY]).toBeUndefined();
  expect(p[SAVES_KEY]).toBeUndefined();
  expect(Object.keys(p).filter((k) => k.startsWith(saveKey('')))).toEqual([]);
});

test('seedGame(page) stores one v2 save in the opening', async ({ page }) => {
  await seedGame(page);
  const p = await load(page);
  expect(p[E2E_GAME_KEY]).toBe('1');
  const { index, save } = seededParts(p);
  expect(index.v).toBe(2);
  expect(index.saves).toHaveLength(1);
  expect(index.saves[0].id).toBe(index.current);
  expect(index.saves[0].phase).toBe('opening');
  expect(save.v).toBe(2);
  expect(save.id).toBe(index.current);
  expect(save.state.phase).toBe('opening');
  expect(save.state.rung).toBe(0);
  expect(save.state.firstWinAt).toBeNull();
});

test('seedGame with a state in the runs loads as current', async ({ page }) => {
  await seedGame(page, { phase: 'runs', units: { home: 500 } });
  const { index, save } = seededParts(await load(page));
  expect(index.saves).toHaveLength(1);
  expect(index.current).toBe(save.id);
  expect(index.saves[0].phase).toBe('runs');
  expect(save.state.phase).toBe('runs');
  expect(save.state.units.home).toBe(500);
  expect(typeof save.state.firstWinAt).toBe('string');
  await page.goto('/about');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  const kept = await page.evaluate(
    (k) => {
      const stored = JSON.parse(localStorage.getItem(k.saves) ?? 'null');
      return { v: stored.v, current: stored.current };
    },
    { saves: SAVES_KEY }
  );
  expect(kept).toEqual({ v: 2, current: save.id });
});

test('newVisitor switches the game on and stores nothing', async ({ page }) => {
  await newVisitor(page);
  const p = await load(page);
  expect(p[E2E_GAME_KEY]).toBe('1');
  expect(p[SAVES_KEY]).toBeUndefined();
  expect(Object.keys(p).filter((k) => k.startsWith(saveKey('')))).toEqual([]);
});

/**
 * A same-origin document the app never runs on: a dataset file. Storage edited here has no game
 * store or save sync beside it, so only the next page load reads the edit.
 */
const OFF_APP = '/data/fixture-0/manifest.json';

/** Leaves the app for OFF_APP; the helpers' init scripts still run there. */
async function leaveApp(page: Page): Promise<void> {
  const response = await page.goto(OFF_APP);
  expect(response?.ok()).toBe(true);
}

test('a reload keeps what the page stored since', async ({ page }) => {
  await seedGame(page, { phase: 'runs' });
  const first = seededParts(await load(page));
  const id = first.index.current;
  await leaveApp(page);
  await page.evaluate(
    (k) => {
      const save = JSON.parse(localStorage.getItem(k.key) ?? 'null');
      save.name = 'Renamed';
      localStorage.setItem(k.key, JSON.stringify(save));
      const index = JSON.parse(localStorage.getItem(k.saves) ?? 'null');
      index.saves[0].name = 'Renamed';
      localStorage.setItem(k.saves, JSON.stringify(index));
    },
    { key: saveKey(id), saves: SAVES_KEY }
  );
  await page.goto('/about');
  const p = await read(page);
  expect(JSON.parse(p[saveKey(id)]).name).toBe('Renamed');
  expect(JSON.parse(p[SAVES_KEY]).saves[0].name).toBe('Renamed');
});

test('a stored index is never overwritten', async ({ page }) => {
  await seedGame(page);
  const id = seededParts(await load(page)).index.current;
  await leaveApp(page);
  await page.evaluate(
    (k) => {
      localStorage.removeItem(k.key);
      const index = JSON.parse(localStorage.getItem(k.saves) ?? 'null');
      index.current = 'other';
      localStorage.setItem(k.saves, JSON.stringify(index));
    },
    { key: saveKey(id), saves: SAVES_KEY }
  );
  await page.goto('/about');
  const p = await read(page);
  expect(p[saveKey(id)]).toBeUndefined();
  expect(JSON.parse(p[SAVES_KEY]).current).toBe('other');
});

test('seedGoalAmount sets the goal and leaves the game open', async ({ page }) => {
  await seedGoalAmount(page, 5000);
  const p = await load(page);
  expect(p[E2E_GOAL_KEY]).toBe('5000');
  expect(p[E2E_GAME_KEY]).toBeUndefined();
});

test('seedRunMs stores the wall time of a run', async ({ page }) => {
  await seedRunMs(page, 500);
  const p = await load(page);
  expect(p[E2E_RUN_MS_KEY]).toBe('500');
  expect(p[E2E_GAME_KEY]).toBeUndefined();
});

test('seedRunMs refuses a time outside 100 to 20000 or not whole', async ({ page }) => {
  const message = 'seedRunMs: ms must be a whole number from 100 to 20000';
  await expect(seedRunMs(page, 99)).rejects.toThrow(message);
  await expect(seedRunMs(page, 1.5)).rejects.toThrow(message);
});

test('the helpers refuse a second game on one page', async ({ page, browser }) => {
  await newVisitor(page);
  await expect(seedGame(page)).rejects.toThrow('seedGame: this page already has a game');
  await expect(newVisitor(page)).rejects.toThrow('newVisitor: this page already has a game');

  const fresh = await browser.newPage();
  try {
    await seedGame(fresh);
    await expect(seedGame(fresh)).rejects.toThrow('seedGame: this page already has a game');
    await expect(newVisitor(fresh)).rejects.toThrow('newVisitor: this page already has a game');
    await expect(seedGoalAmount(fresh, 0)).rejects.toThrow(
      'seedGoalAmount: amount must be a whole number of at least 1'
    );
  } finally {
    await fresh.close();
  }
});

test('storage that refuses writes still loads', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('denied', 'QuotaExceededError');
    };
  });
  await seedGame(page);
  const response = await page.goto('/about');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('storage that throws on access still loads', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      }
    });
  });
  await seedGame(page);
  const response = await page.goto('/about');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
