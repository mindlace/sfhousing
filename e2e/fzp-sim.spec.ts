// timelapse-sim spec §6, deferred to the page: what the worker fetches, how fast the first timeline
// arrives, and that a reroll changes the future but not the band. Runs against the VITE_E2E build
// (window.__sfhFzp, src/lib/fzp/debug.ts). Autoplay is stopped with reduced motion.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { jumpAndIdle, type Win } from './helpers/sharing';

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

/**
 * The band and the plan effect are complete. A provisional score still has them, with the
 * scoreboard saying "calculating" or "(still calculating)" and marking the lines `aria-busy`
 * (score-view.ts bandLine/planBandLine), so completeness is read from those two signs.
 */
async function settled(page: Page): Promise<void> {
  const board = page.locator('.sfh-fzp-scoreboard');
  await expect(board.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(board).not.toContainText(/calculating/);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// fixture-0 has one parcel chunk, so on its own a test cannot tell "the viewport's chunks" from
// "every chunk". This test adds a second chunk, in the far south-west corner of the map's
// bounds (src/lib/map/camera.ts maxBounds), to the manifest the page
// loads: a worker that fetched every chunk would request it at once.
const FAR_CELL = '10_10';
const FAR_BBOX: [number, number, number, number] = [-122.555, 37.7, -122.545, 37.71];
const chunkUrl = (cellId: string): string => `/data/fixture-0/parcels/${cellId}.json`;

test('fetches only the viewport chunks and the three scenario files', async ({ page }) => {
  await page.route('**/manifest.json', async (route) => {
    const response = await route.fetch();
    const m = (await response.json()) as { chunks: unknown[] };
    m.chunks.push({
      cellId: FAR_CELL,
      bbox: FAR_BBOX,
      url: chunkUrl(FAR_CELL),
      parcelCount: 1
    });
    await route.fulfill({ response, json: m });
  });
  await page.route(`**${chunkUrl(FAR_CELL)}`, (route) => route.fulfill({ status: 404 }));
  // The worker's requests are reported on the page, so one listener sees both.
  const urls: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith('/data/fixture-0/')) urls.push(pathname);
  });
  const chunkRequests = () => urls.filter((u) => u.includes('/parcels/'));

  // SvelteKit replays the server's manifest on a first load, so reach /fzp by a client
  // navigation from a page that loads none (as in e2e/fzp.spec.ts's no-scenario test).
  await page.goto('/about');
  await page.getByRole('banner').getByRole('link', { name: 'Timelapse', exact: true }).click();
  await waitReady(page);

  const bounds = await page.evaluate(() => {
    const b = (window as Win).__sfhMap!.map!.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  });
  const intersects = (bbox: number[]) =>
    bbox[0] <= bounds[2] && bounds[0] <= bbox[2] && bbox[1] <= bounds[3] && bounds[1] <= bbox[3];
  const inView = manifest.chunks.filter((c) => intersects(c.bbox)).map((c) => chunkUrl(c.cellId));
  expect(inView.length).toBeGreaterThan(0);
  expect(intersects(FAR_BBOX), 'the far chunk must start outside the viewport').toBe(false);

  // The viewport's chunk is prefetched after the first timeline.
  await expect.poll(() => [...new Set(chunkRequests())].sort()).toEqual(inView.sort());
  const scenarios = new Set(urls.filter((u) => u.includes('/scenarios/')));
  expect([...scenarios].sort()).toEqual([...SCENARIO_FILES].sort());

  // Panning to the far chunk fetches it, and only then.
  expect(chunkRequests()).not.toContain(chunkUrl(FAR_CELL));
  await jumpAndIdle(page, { center: [-122.55, 37.705], zoom: 16, pitch: 0, bearing: 0 });
  await expect.poll(() => chunkRequests()).toContain(chunkUrl(FAR_CELL));
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
  // `settled` waited for a complete band; an empty one would make the comparison below trivial.
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
