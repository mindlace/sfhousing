import { expect, test, type Page } from '@playwright/test';
import { newVisitor, seedGame } from './helpers/game';
import { savedGame } from './helpers/play';
import { SAVES_KEY, saveKey } from '../src/lib/game/saves';

type Entry = { id: string; phase: 'opening' | 'runs'; round: number };
type Index = { v: number; current: string; saves: Entry[] };

function hydrationWarnings(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('hydration_mismatch')) seen.push(m.text());
  });
  return seen;
}
async function openAbout(page: Page): Promise<void> {
  await page.goto('/about');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}
const item = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

async function index(page: Page): Promise<Index> {
  const text = await item(page, SAVES_KEY);
  expect(text).not.toBeNull();
  return JSON.parse(text ?? 'null');
}

test('with no helper, /about has no hydration warning and stores no saves', async ({ page }) => {
  const warnings = hydrationWarnings(page);
  await openAbout(page);
  expect(warnings).toEqual([]);
  expect(await item(page, SAVES_KEY)).toBeNull();
});

test('a new visitor gets one game in the opening', async ({ page }) => {
  const warnings = hydrationWarnings(page);
  await newVisitor(page);
  await openAbout(page);
  const stored = await index(page);
  expect(stored.v).toBe(2);
  expect(stored.saves).toHaveLength(1);
  expect(stored.current).toBe(stored.saves[0].id);
  expect(stored.saves[0].phase).toBe('opening');
  expect(stored.saves[0].round).toBe(0);
  const save = await savedGame(page);
  expect(save.v).toBe(2);
  expect(save.id).toBe(stored.current);
  expect(save.state.phase).toBe('opening');
  expect(save.state.round).toBe(0);
  expect(warnings).toEqual([]);
});

test('a seeded index is kept as seeded', async ({ page }) => {
  await seedGame(page);
  await page.addInitScript((k) => {
    (window as unknown as { __seededIndex: string | null }).__seededIndex = localStorage.getItem(k);
  }, SAVES_KEY);
  await openAbout(page);
  const seeded = await page.evaluate(
    () => (window as unknown as { __seededIndex: string | null }).__seededIndex
  );
  expect(seeded).not.toBeNull();
  expect(await item(page, SAVES_KEY)).toBe(seeded);
});

test('a current id that names no entry gets a new game in the opening', async ({ page }) => {
  await seedGame(page, { phase: 'runs', round: 2 });
  await openAbout(page);
  const seededId = (await index(page)).current;
  await page.evaluate((k) => {
    const stored = JSON.parse(localStorage.getItem(k) ?? 'null');
    stored.current = 'missing';
    localStorage.setItem(k, JSON.stringify(stored));
  }, SAVES_KEY);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  const stored = await index(page);
  expect(stored.saves).toHaveLength(2);
  const kept = stored.saves.find((s) => s.id === seededId);
  expect(kept?.phase).toBe('runs');
  expect(stored.current).not.toBe(seededId);
  expect(stored.current).not.toBe('missing');
  const fresh = stored.saves.find((s) => s.id === stored.current);
  expect(fresh?.phase).toBe('opening');
  expect(fresh?.round).toBe(0);
  const current = await savedGame(page);
  expect(current.id).toBe(stored.current);
  expect(current.state.phase).toBe('opening');
  const old = JSON.parse((await item(page, saveKey(seededId))) ?? 'null');
  expect(old.state.round).toBe(2);
});

test('a five-level index and save are deleted at load, never moved aside', async ({ page }) => {
  const old = 'oldfivelevel';
  await newVisitor(page);
  await page.addInitScript(
    (a) => {
      try {
        if (localStorage.getItem(a.saves) !== null) return;
        localStorage.setItem(
          a.saves,
          JSON.stringify({
            v: 1,
            current: a.id,
            saves: [{ id: a.id, name: 'Old', nameIsDefault: false, savedAt: a.at, level: 3 }]
          })
        );
        localStorage.setItem(
          a.key,
          JSON.stringify({ v: 1, id: a.id, name: 'Old', savedAt: a.at, progress: { level: 3 } })
        );
      } catch {
        // storage refused: the test's own checks fail
      }
    },
    { saves: SAVES_KEY, id: old, key: saveKey(old), at: new Date().toISOString() }
  );
  await openAbout(page);
  const kept = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) out[key] = localStorage.getItem(key) ?? '';
    }
    return out;
  });
  expect(kept[saveKey(old)]).toBeUndefined();
  expect(Object.keys(kept).filter((k) => k.startsWith(saveKey('corrupt:')))).toEqual([]);
  const records = Object.entries(kept).filter(
    ([k]) => k === SAVES_KEY || k.startsWith(saveKey(''))
  );
  expect(records.length).toBeGreaterThan(0);
  for (const [, text] of records) {
    let v: unknown = null;
    try {
      v = (JSON.parse(text) as { v?: unknown } | null)?.v;
    } catch {
      // not JSON: not a five-level record
    }
    expect(v).not.toBe(1);
  }
  const stored = await index(page);
  expect(stored.v).toBe(2);
  expect(stored.saves).toHaveLength(1);
  expect(stored.saves[0].id).not.toBe(old);
  expect(stored.saves[0].phase).toBe('opening');
});
