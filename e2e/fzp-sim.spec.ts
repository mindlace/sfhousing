// timelapse-sim spec §6, deferred to the page, on the simulation's timeline (the open game at
// `/`): what the worker fetches, and
// that the same document after a reload fills the same forecast. Runs against the VITE_E2E build
// (window.__sfhFzp, src/lib/fzp/debug.ts). The first month's wall-clock budget lives in
// e2e/perf/first-month.perf.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { waitFilled } from './helpers/run';
import { gotoHydrated, jumpAndIdle, openHeaderMenu, type Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

const MANIFEST_URL = new URL('./fixtures/data/fixture-0/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8')) as {
  chunks: { cellId: string; bbox: [number, number, number, number] }[];
  scenarios: {
    fzp: Record<'parcels' | 'projects' | 'calibration', string> &
      Partial<Record<'policy' | 'options' | 'frontage' | 'cars' | 'carZones', string>>;
  };
};
const { fzp } = manifest.scenarios;
// The simulation reads these six: the timelapse's three, the lever engine's policy.bin, and
// options.bin and the car system's cars.bin, each fetched only when the manifest names it (fixture-0
// names both). The brush catalog (asked for when the editor first shows something) reads only
// transit.json and neighborhoods.geojson, never frontage.bin.
const SIM_FILES = [fzp.parcels, fzp.projects, fzp.calibration, fzp.policy, fzp.options!, fzp.cars!];

/** The world's completed net homes per filled month (`__sfhFzp.completedNet()`). */
const completedOf = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.completedNet());

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// fixture-0's two parcel chunks are neighbouring cells, so on their own a test cannot tell "the
// viewport's chunks" from "every chunk". This test adds a third chunk, in the far south-west corner
// of the map's bounds (src/lib/map/camera.ts maxBounds), to the manifest the page loads: a worker
// that fetched every chunk would request it at once.
const FAR_CELL = '10_10';
const FAR_BBOX: [number, number, number, number] = [-122.555, 37.7, -122.545, 37.71];
const chunkUrl = (cellId: string): string => `/data/fixture-0/parcels/${cellId}.json`;

test('fetches only the viewport chunks, the scenario files, policy.bin, options.bin and cars.bin', async ({
  page
}) => {
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

  // SvelteKit replays the server's manifest on a first load, so reach the simulation (the open
  // game at `/`) by a client navigation, by the site name, from a page that loads none (as in
  // e2e/fzp.spec.ts's no-scenario test).
  await gotoHydrated(page, '/about');
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'SF Housing', exact: true }).click();
  await waitReady(page);
  // `ready` is the worker's first months; the map can still be loading.
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );

  const bounds = await page.evaluate(() => {
    const b = (window as Win).__sfhMap!.map!.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  });
  const intersects = (bbox: number[]) =>
    bbox[0] <= bounds[2] && bounds[0] <= bbox[2] && bbox[1] <= bounds[3] && bounds[1] <= bbox[3];
  const inView = manifest.chunks.filter((c) => intersects(c.bbox)).map((c) => chunkUrl(c.cellId));
  expect(inView.length).toBeGreaterThan(0);
  expect(intersects(FAR_BBOX), 'the far chunk must start outside the viewport').toBe(false);

  // The viewport's chunk is prefetched after the first `compiled`.
  await expect.poll(() => [...new Set(chunkRequests())].sort()).toEqual(inView.sort());
  expect(fzp.policy, 'fixture-0 names policy').toBeTruthy();
  expect(fzp.options, 'fixture-0 names options').toBeTruthy();
  expect(fzp.cars, 'fixture-0 names cars').toBeTruthy();
  // The same six files whether or not the editor is open; the brush catalog adds none.
  await expect
    .poll(() => [...new Set(urls.filter((u) => u.includes('/scenarios/')))].sort())
    .toEqual(SIM_FILES.sort());
  expect(
    urls.some((u) => u.endsWith('/frontage.bin')),
    'the page never fetches frontage.bin'
  ).toBe(false);

  // Panning to the far chunk fetches it, and only then.
  expect(chunkRequests()).not.toContain(chunkUrl(FAR_CELL));
  await jumpAndIdle(page, { center: [-122.55, 37.705], zoom: 16, pitch: 0, bearing: 0 });
  await expect.poll(() => chunkRequests()).toContain(chunkUrl(FAR_CELL));
});

test('the same document after a reload fills an identical forecast', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await waitFilled(page);
  const first = await completedOf(page);
  expect(first.length).toBeGreaterThan(0);

  await page.reload();
  await waitReady(page);
  await waitFilled(page);
  expect(await completedOf(page)).toEqual(first);
});
