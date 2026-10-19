// timelapse-sim spec §6, deferred to the page: what the worker fetches, how fast the first timeline
// arrives, and that a reroll changes the future but not the band. Runs against the VITE_E2E build
// (window.__sfhFzp, src/lib/fzp/debug.ts). Autoplay is stopped with reduced motion.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import type { Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

const MANIFEST_URL = new URL('./fixtures/data/fixture-0/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8')) as {
  chunks: { cellId: string; bbox: [number, number, number, number] }[];
  scenarios: { fzp: Record<'parcels' | 'projects' | 'calibration', string> };
};
const SCENARIO_FILES = Object.values(manifest.scenarios.fzp);

const scoreJson = (page: Page, field?: 'shown' | 'band'): Promise<string> =>
  page.evaluate((f) => {
    const s = (window as FzpWin).__sfhFzp!.score;
    return JSON.stringify(f ? s?.[f] : s);
  }, field);

const seedOf = (page: Page): Promise<number | null> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.seed);

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
}

/** The band and plan-effect lines stop saying "still calculating". */
const settled = (page: Page) =>
  expect(page.locator('.sfh-fzp-scoreboard [aria-busy="true"]')).toHaveCount(0, {
    timeout: 20_000
  });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('fetches only the viewport chunks and the three scenario files', async ({ page }) => {
  // The worker's requests are reported on the page, so one listener sees both.
  const urls: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith('/data/fixture-0/')) urls.push(pathname);
  });
  await page.goto('/fzp');
  await waitReady(page);
  await page.waitForTimeout(1_000); // the viewport prefetch follows the first timeline

  const bounds = await page.evaluate(() => {
    const b = (window as Win).__sfhMap!.map!.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  });
  const inView = manifest.chunks
    .filter(
      ({ bbox }) =>
        bbox[0] <= bounds[2] && bounds[0] <= bbox[2] && bbox[1] <= bounds[3] && bounds[1] <= bbox[3]
    )
    .map((c) => `/data/fixture-0/parcels/${c.cellId}.json`);

  const scenarios = new Set(urls.filter((u) => u.includes('/scenarios/')));
  const chunks = new Set(urls.filter((u) => u.includes('/parcels/')));
  expect([...scenarios].sort()).toEqual([...SCENARIO_FILES].sort());
  expect([...chunks].sort()).toEqual([...inView].sort());
});

test('the first timeline arrives within 3 s of navigation', async ({ page }) => {
  const start = Date.now();
  await page.goto('/fzp', { waitUntil: 'commit' });
  await expect
    .poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp?.score != null), {
      timeout: 3_000,
      intervals: [50]
    })
    .toBe(true);
  expect(Date.now() - start).toBeLessThan(3_100);
});

test('a reroll changes the future, not the band', async ({ page }) => {
  await page.goto('/fzp');
  await waitReady(page);
  await settled(page);
  const seed = await seedOf(page);
  const shown = await scoreJson(page, 'shown');
  const band = await scoreJson(page, 'band');
  // Settled means the band is complete: a provisional score has null entries.
  expect(JSON.parse(band)).not.toContain(null);
  expect(JSON.parse(band).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Another future' }).click();
  await expect.poll(() => seedOf(page)).not.toBe(seed);
  await settled(page);

  expect(await scoreJson(page, 'shown')).not.toBe(shown);
  expect(await scoreJson(page, 'band')).toBe(band);
});

test('the same URL seed after a reload gives an identical timeline score', async ({ page }) => {
  await page.goto('/fzp?seed=12345');
  await waitReady(page);
  await settled(page);
  const first = await scoreJson(page);
  expect(JSON.parse(first)).not.toBeNull();

  await page.reload();
  await waitReady(page);
  await settled(page);
  expect(await seedOf(page)).toBe(12345);
  expect(await scoreJson(page)).toBe(first);
});
