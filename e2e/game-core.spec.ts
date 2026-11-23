import { expect, test, type Page } from '@playwright/test';
import { newVisitor, seedGame } from './helpers/game';
import { SAVES_KEY, saveKey } from '../src/lib/game/saves';

type Index = {
  v: number;
  current: string;
  saves: { id: string; level: number }[];
};

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

async function levelOf(page: Page, id: string): Promise<number> {
  const text = await item(page, saveKey(id));
  expect(text).not.toBeNull();
  return JSON.parse(text ?? 'null').progress.level;
}

test('with no helper the layout provides the open game', async ({ page }) => {
  const warnings = hydrationWarnings(page);
  await openAbout(page);
  expect(warnings).toEqual([]);
  expect(await item(page, SAVES_KEY)).toBeNull();
});

test('a new visitor gets one level 1 game', async ({ page }) => {
  const warnings = hydrationWarnings(page);
  await newVisitor(page);
  await openAbout(page);
  const stored = await index(page);
  expect(stored.saves).toHaveLength(1);
  expect(stored.saves[0].level).toBe(1);
  expect(stored.current).toBe(stored.saves[0].id);
  expect(await levelOf(page, stored.current)).toBe(1);
  expect(warnings).toEqual([]);
});

test('a seeded index is kept as seeded', async ({ page }) => {
  await seedGame(page, 3);
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

test('a current id that names no entry gets a new level 1 game', async ({ page }) => {
  await seedGame(page, 3);
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
  expect(kept?.level).toBe(3);
  expect(await levelOf(page, seededId)).toBe(3);
  expect(stored.current).not.toBe(seededId);
  expect(stored.current).not.toBe('missing');
  const fresh = stored.saves.find((s) => s.id === stored.current);
  expect(fresh?.level).toBe(1);
  expect(await levelOf(page, stored.current)).toBe(1);
});
