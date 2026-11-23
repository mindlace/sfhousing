import { expect, test, type Page } from '@playwright/test';
import { SEED_BAR_DAY, newVisitor, seedGame, seedGoalAmount } from './helpers/game';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from '../src/lib/game/e2e';
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
          if (key === k.game || key === k.goal || key === k.saves || key.startsWith(k.prefix))
            out[key] = localStorage.getItem(key) ?? '';
        }
      } catch {
        // storage refused: the probe stays empty
      }
      (window as unknown as { __gameProbe: Record<string, string> }).__gameProbe = out;
    },
    { game: E2E_GAME_KEY, goal: E2E_GOAL_KEY, saves: SAVES_KEY, prefix: saveKey('') }
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
  progress: { level: number; banked: Record<string, { on: number }>; firstWinAt: string | null };
};

function seededParts(p: Probe): {
  index: { current: string; saves: { id: string }[] };
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

test('seedGame(page, 5) seeds a level 5 game with three bars', async ({ page }) => {
  await seedGame(page, 5);
  const p = await load(page);
  expect(p[E2E_GAME_KEY]).toBe('1');
  const { index, save } = seededParts(p);
  expect(index.saves).toHaveLength(1);
  expect(index.saves[0].id).toBe(index.current);
  expect(save.progress.level).toBe(5);
  expect(Object.keys(save.progress.banked).sort()).toEqual(['2', '3', '4']);
  for (const bar of Object.values(save.progress.banked)) expect(bar.on).toBe(SEED_BAR_DAY);
  expect(typeof save.progress.firstWinAt).toBe('string');
});

test('a seeded game is what the page keeps', async ({ page }) => {
  await seedGame(page, 5);
  await page.goto('/about');
  await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
  const kept = await page.evaluate(
    (k) => {
      const index = JSON.parse(localStorage.getItem(k.saves) ?? 'null');
      const save = JSON.parse(localStorage.getItem(k.prefix + index.current) ?? 'null');
      return { current: index.current, id: save.id, level: save.progress.level };
    },
    { saves: SAVES_KEY, prefix: saveKey('') }
  );
  expect(kept.level).toBe(5);
  expect(kept.id).toBe(kept.current);
});

test('SEED_BAR_DAY is the first of October 2066', () => {
  expect(new Date(SEED_BAR_DAY * 86_400_000).toISOString().slice(0, 10)).toBe('2066-10-01');
});

test('seedGame at level 3', async ({ page }) => {
  await seedGame(page, 3);
  const { save } = seededParts(await load(page));
  expect(save.progress.level).toBe(3);
  expect(Object.keys(save.progress.banked)).toEqual(['2']);
});

test('seedGame at level 2', async ({ page }) => {
  await seedGame(page, 2);
  const { save } = seededParts(await load(page));
  expect(save.progress.level).toBe(2);
  expect(save.progress.banked).toEqual({});
  expect(typeof save.progress.firstWinAt).toBe('string');
});

test('seedGame at level 1', async ({ page }) => {
  await seedGame(page, 1);
  const { save } = seededParts(await load(page));
  expect(save.progress.level).toBe(1);
  expect(save.progress.banked).toEqual({});
  expect(save.progress.firstWinAt).toBeNull();
});

test('newVisitor switches the game on and stores nothing', async ({ page }) => {
  await newVisitor(page);
  const p = await load(page);
  expect(p[E2E_GAME_KEY]).toBe('1');
  expect(p[SAVES_KEY]).toBeUndefined();
  expect(Object.keys(p).filter((k) => k.startsWith(saveKey('')))).toEqual([]);
});

test('the seed is written once', async ({ page }) => {
  await seedGame(page, 3);
  const first = seededParts(await load(page));
  const id = first.index.current;
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
  await page.reload();
  const p = await read(page);
  expect(JSON.parse(p[saveKey(id)]).name).toBe('Renamed');
  expect(JSON.parse(p[SAVES_KEY]).saves[0].name).toBe('Renamed');
});

test('a stored index is never overwritten', async ({ page }) => {
  await seedGame(page, 3);
  const id = seededParts(await load(page)).index.current;
  await page.evaluate(
    (k) => {
      localStorage.removeItem(k.key);
      const index = JSON.parse(localStorage.getItem(k.saves) ?? 'null');
      index.current = 'other';
      localStorage.setItem(k.saves, JSON.stringify(index));
    },
    { key: saveKey(id), saves: SAVES_KEY }
  );
  await page.reload();
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

test('the helpers refuse bad calls', async ({ page, browser }) => {
  await newVisitor(page);
  await expect(seedGame(page, 3)).rejects.toThrow('seedGame: this page already has a game');

  const fresh = await browser.newPage();
  try {
    await expect(seedGame(fresh, 6 as never)).rejects.toThrow('seedGame: level must be 1 to 5');
    await seedGame(fresh, 3);
    await expect(seedGoalAmount(fresh, 0)).rejects.toThrow(
      'seedGoalAmount: amount must be a whole number of at least 1'
    );
    await expect(newVisitor(fresh)).rejects.toThrow('newVisitor: this page already has a game');
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
  await seedGame(page, 3);
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
  await seedGame(page, 3);
  const response = await page.goto('/about');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
