// Plan-sharing notices (spec §4.5/§4.8) against the W6b layout: the NoticeStack never covers the
// brush toolbar, the scoreboard panel / score bar, map-view's failure chips or its attribution
// control, at every width from 375 to 1440 px.
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  FRAME,
  PLAN_KEY,
  gotoEditor,
  jumpAndIdle,
  oldVersionText,
  smallText,
  waitForMap
} from './helpers/sharing';

const CHUNK = '**/data/fixture-0/parcels/50_25.json';
const BUILDINGS = '**/data/fixture-0/buildings.pmtiles';

type Box = { x: number; y: number; width: number; height: number };

/**
 * Seeds the autosave with `old-version.json` (dataset `fixture-0000`) before the first load, so
 * restore rebases it onto fixture-0 and shows N3. Init scripts run on every navigation: a
 * sessionStorage flag keeps a reload from re-seeding.
 */
async function seedOldPlan(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, plan }) => {
      if (sessionStorage.getItem('sfh-e2e-seeded')) return;
      sessionStorage.setItem('sfh-e2e-seeded', '1');
      localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), plan }));
    },
    { key: PLAN_KEY, plan: oldVersionText }
  );
}

/** Both map-view failure chips: the parcel chunk aborts, the buildings archive 404s. */
async function failMapData(page: Page): Promise<void> {
  await page.route(CHUNK, (r) => r.abort());
  await page.route(BUILDINGS, (r) => r.fulfill({ status: 404 }));
}

const chunkChip = (page: Page): Locator =>
  page.getByRole('status').filter({ hasText: "Some parcels didn't load —" });
const buildingsChip = (page: Page): Locator =>
  page
    .getByRole('status')
    .filter({ hasText: "Existing buildings couldn't load. Generated buildings still work." });
const scoreRegion = (page: Page): Locator =>
  page.getByRole('region', { name: 'Housing scoreboard' });
const notice = (page: Page): Locator => page.getByTestId('notice');

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

const fmt = (b: Box): string =>
  `[${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}]`;

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The map chrome a notice must leave uncovered at this width (only what is rendered). */
async function chrome(page: Page): Promise<[string, Locator][]> {
  const all: [string, Locator][] = [
    ['brush toolbar', page.locator('.brush-toolbar')],
    ['brush status line', page.locator('.brush-status')],
    ['scoreboard panel', scoreRegion(page).locator('div.md\\:block').first()],
    ['score bar', scoreRegion(page).locator('button[aria-controls]').first()],
    ['parcels chip', chunkChip(page)],
    ['buildings chip', buildingsChip(page)],
    ['attribution', page.locator('.maplibregl-ctrl-attrib')],
    ['navigation control', page.locator('.maplibregl-ctrl-group')]
  ];
  const shown: [string, Locator][] = [];
  for (const [name, loc] of all) if (await loc.isVisible()) shown.push([name, loc]);
  return shown;
}

/** Every notice box lies inside #map-region and intersects none of the visible chrome. */
const BASE = ['brush toolbar', 'parcels chip', 'buildings chip', 'attribution'];
/** Required chrome per project: the scoreboard panel on desktop, the score bar on mobile. */
const DESKTOP = [...BASE, 'scoreboard panel'];
const MOBILE = [...BASE, 'score bar'];

async function expectNoticesClear(page: Page, required: string[]): Promise<void> {
  const region = await box(page.locator('#map-region'));
  const items = await chrome(page);
  const names = items.map(([n]) => n);
  // The required chrome is all present, so the check below is not vacuous.
  for (const must of required) {
    expect(names, `${must} not rendered`).toContain(must);
  }

  const count = await notice(page).count();
  expect(count).toBeGreaterThan(0);
  const overlaps: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = await box(notice(page).nth(i));
    expect(n.x).toBeGreaterThanOrEqual(region.x - 0.5);
    expect(n.y).toBeGreaterThanOrEqual(region.y - 0.5);
    expect(n.x + n.width).toBeLessThanOrEqual(region.x + region.width + 0.5);
    expect(n.y + n.height).toBeLessThanOrEqual(region.y + region.height + 0.5);
    for (const [name, loc] of items) {
      const c = await box(loc);
      if (intersects(n, c)) overlaps.push(`notice ${i} ${fmt(n)} overlaps ${name} ${fmt(c)}`);
    }
  }
  expect(overlaps, overlaps.join('\n')).toEqual([]);
  // Painted on top: each notice's corners (inset past the 8 px radius) hit the notice itself.
  for (let i = 0; i < count; i++) {
    const hits = await notice(page)
      .nth(i)
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const pts: [number, number][] = [
          [r.left + 8, r.top + 8],
          [r.right - 8, r.top + 8],
          [r.left + 8, r.bottom - 8],
          [r.right - 8, r.bottom - 8]
        ];
        return pts.map(([x, y]) => {
          const top = document.elementFromPoint(x, y);
          return !!top && el.contains(top);
        });
      });
    expect(hits).toEqual([true, true, true, true]);
  }
}

/** `/` with N3 showing and both failure chips up, on the fixture frame. */
async function gotoWithN3AndChips(page: Page): Promise<void> {
  await seedOldPlan(page);
  await failMapData(page);
  await gotoEditor(page);
  await jumpAndIdle(page, FRAME);
  await expect(notice(page).filter({ hasText: 'older map dataset (fixture-0000)' })).toBeVisible();
  await expect(chunkChip(page)).toBeVisible({ timeout: 10_000 });
  await expect(buildingsChip(page)).toBeVisible({ timeout: 10_000 });
}

test.describe('desktop', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'chromium project only');

  // `beside`: from lg the stack starts right of the toolbar column (below lg, under the toolbar).
  for (const [width, height, beside] of [
    [768, 1024, false],
    [1024, 768, true],
    [1280, 800, true],
    [1440, 900, true]
  ] as const) {
    test(`${width}×${height}: N3 clear of toolbar, scoreboard, chips and attribution`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await gotoWithN3AndChips(page);
      await expectNoticesClear(page, DESKTOP);
      // Out of the scoreboard column at any panel height; from xl, out of the toolbar's too.
      const n = await box(notice(page).first());
      const panel = await box(scoreRegion(page).locator('div.md\\:block').first());
      expect(n.x + n.width).toBeLessThanOrEqual(panel.x);
      const toolbar = await box(page.locator('.brush-toolbar'));
      expect(n.x >= toolbar.x + toolbar.width).toBe(beside);
    });
  }

  test('1024×768: N3 stays clear when the keyboard shortcuts grow the toolbar', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoWithN3AndChips(page);
    const toggle = page
      .locator('.brush-toolbar')
      .getByRole('button', { name: 'Keyboard shortcuts' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.brush-toolbar table')).toBeVisible();
    await expectNoticesClear(page, DESKTOP);
  });

  test('1024×768: the Remix toast is clear of the map chrome too', async ({ page, request }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const res = await request.post('/api/plans', {
      data: smallText,
      headers: { 'content-type': 'application/json' }
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/p/${id}`);
    await waitForMap(page);
    // Only the parcels chip here: a client-side navigation with the buildings archive failing
    // can leave the fresh map loading.
    await page.route(CHUNK, (r) => r.abort());
    await page
      .getByRole('region', { name: 'Shared plan' })
      .getByRole('button', { name: 'Remix' })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await waitForMap(page);
    await jumpAndIdle(page, FRAME);
    await expect(notice(page).filter({ hasText: /^Remixed from/ })).toBeVisible();
    await expect(chunkChip(page)).toBeVisible({ timeout: 10_000 });
    await expectNoticesClear(page, [
      'brush toolbar',
      'parcels chip',
      'attribution',
      'scoreboard panel'
    ]);
  });
});

test.describe('mobile', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  test('375×812: N3 clear of the bars, chips and attribution; no horizontal scroll', async ({
    page
  }) => {
    await gotoWithN3AndChips(page);
    // MapLibre starts compact attribution expanded; either state must stay uncovered.
    await expectNoticesClear(page, MOBILE);
    await page.evaluate(() =>
      document
        .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')
        ?.classList.remove('maplibregl-compact-show')
    );
    await expectNoticesClear(page, MOBILE);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBe(true);
    // Below 640 px the stack keeps 60 px clear on the right (W6b rule).
    const region = await box(page.locator('#map-region'));
    const n = await box(notice(page).first());
    expect(region.x + region.width - (n.x + n.width)).toBeGreaterThanOrEqual(60 - 0.5);
    // The notice text wraps inside its box.
    expect(
      await notice(page)
        .first()
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);

    // The score bar's sheet (z-30, a modal surface) may open over the notice; on close the notice
    // is back on top and still clear of the score bar.
    const bar = scoreRegion(page).locator('button[aria-controls]').first();
    await bar.tap();
    await expect(page.getByRole('group', { name: 'Scoreboard details' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Scoreboard details' })).toBeHidden();
    await expectNoticesClear(page, MOBILE);
  });
});
