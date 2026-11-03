// Plan-sharing notices (spec §4.5/§4.8) on the sim-ux layout: N1 to N3 and the Remix toast are
// pills in BrushEditor's one notice stack (`fzp-notices`, after the brush status), as on /sim
// (sim-ux spec Goal 8). From 768 px the stack overlays the map's top centre, right of the dock; below
// 768 px it is in flow under the header. Either way a notice never covers the dock, map-view's
// failure chips, its attribution or its navigation control, at every width from 375 to 1440 px.
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
const notice = (page: Page): Locator => page.getByTestId('notice');
const stack = (page: Page): Locator => page.getByTestId('fzp-notices');

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
    ['dock panel', page.locator('.sfh-dock-panel')],
    ['dock rail', page.getByTestId('dock-rail')],
    ['dock handle', page.getByTestId('dock-handle')],
    ['parcels chip', chunkChip(page)],
    ['buildings chip', buildingsChip(page)],
    ['attribution', page.locator('.maplibregl-ctrl-attrib')],
    ['navigation control', page.locator('.maplibregl-ctrl-group')]
  ];
  const shown: [string, Locator][] = [];
  for (const [name, loc] of all) if (await loc.isVisible()) shown.push([name, loc]);
  return shown;
}

const BASE = ['parcels chip', 'buildings chip', 'attribution'];
/** Required chrome per project: the dock's panel on desktop, its sheet handle on mobile. */
const DESKTOP = [...BASE, 'dock panel'];
const MOBILE = [...BASE, 'dock handle'];

/**
 * One notice stack, every notice a pill inside it, inside #map-region, intersecting none of the
 * visible chrome and painted on top.
 */
async function expectNoticesClear(page: Page, required: string[]): Promise<void> {
  await expect(stack(page)).toHaveCount(1);
  const region = await box(page.locator('#map-region'));
  const items = await chrome(page);
  const names = items.map(([n]) => n);
  // The required chrome is all present, so the check below is not vacuous.
  for (const must of required) {
    expect(names, `${must} not rendered`).toContain(must);
  }

  const count = await notice(page).count();
  expect(count).toBeGreaterThan(0);
  await expect(stack(page).getByTestId('notice')).toHaveCount(count);
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
  // Painted on top: each notice's corners (inset past the pill's radius) hit the notice itself.
  for (let i = 0; i < count; i++) {
    const hits = await notice(page)
      .nth(i)
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const inset = Math.min(r.height / 2, 16);
        const pts: [number, number][] = [
          [r.left + inset, r.top + inset],
          [r.right - inset, r.top + inset],
          [r.left + inset, r.bottom - inset],
          [r.right - inset, r.bottom - inset]
        ];
        return pts.map(([x, y]) => {
          const top = document.elementFromPoint(x, y);
          return !!top && el.contains(top);
        });
      });
    expect(hits).toEqual([true, true, true, true]);
  }
}

/** From md the stack is centred over the map right of the dock (its panel or rail). */
async function expectCentredRightOfDock(page: Page, dock: Locator): Promise<void> {
  const region = await box(page.locator('#map-region'));
  const d = await box(dock);
  const n = await box(notice(page).first());
  const mid = (d.x + d.width + region.x + region.width) / 2;
  expect(Math.abs(n.x + n.width / 2 - mid)).toBeLessThanOrEqual(1);
  expect(n.x).toBeGreaterThanOrEqual(d.x + d.width);
}

/**
 * SimMap's failure chips sit right of the dock (its panel or rail), centred on the map it leaves
 * uncovered, as the notice stack is.
 */
async function expectChipsRightOfDock(page: Page, dock: Locator): Promise<void> {
  const region = await box(page.locator('#map-region'));
  const d = await box(dock);
  const mid = (d.x + d.width + region.x + region.width) / 2;
  for (const chip of [chunkChip(page), buildingsChip(page)]) {
    const c = await box(chip);
    expect(c.x, `chip ${fmt(c)} under the dock ${fmt(d)}`).toBeGreaterThanOrEqual(d.x + d.width);
    expect(c.x + c.width).toBeLessThanOrEqual(region.x + region.width);
    expect(Math.abs(c.x + c.width / 2 - mid)).toBeLessThanOrEqual(1);
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

  for (const [width, height] of [
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1440, 900]
  ] as const) {
    test(`${width}×${height}: N3 is a pill in the one stack, clear of the dock, chips and attribution`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await gotoWithN3AndChips(page);
      await expectNoticesClear(page, DESKTOP);
      await expectCentredRightOfDock(page, page.locator('.sfh-dock-panel'));
      await expectChipsRightOfDock(page, page.locator('.sfh-dock-panel'));
      // A pill: fully rounded.
      const radius = await notice(page)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
      expect(radius).toBeGreaterThanOrEqual(16);
    });
  }

  test('1024×768: folded to the rail, the stack recentres and stays clear', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoWithN3AndChips(page);
    await page.getByRole('button', { name: 'Collapse Paint' }).click();
    const rail = page.getByTestId('dock-rail');
    await expect(rail).toBeVisible();
    await expectNoticesClear(page, [...BASE, 'dock rail']);
    await expectCentredRightOfDock(page, rail);
    await expectChipsRightOfDock(page, rail);
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
    await expectNoticesClear(page, ['parcels chip', 'attribution', 'dock panel']);
  });
});

test.describe('mobile', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  test('375×812: N3 under the header, clear of the handle, chips and attribution; no horizontal scroll', async ({
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
    // In flow under the header (above the map, which it pushes down).
    const header = await box(page.locator('header').first());
    const n = await box(notice(page).first());
    expect(n.y).toBeGreaterThanOrEqual(header.y + header.height);
    const map = await box(page.getByTestId('map-root'));
    expect(n.y + n.height).toBeLessThanOrEqual(map.y + 0.5);
    // The notice text wraps inside its box.
    expect(
      await notice(page)
        .first()
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);

    // The dock's sheet opened full stays in the map box: the notice keeps its place, unobscured.
    const handle = page.getByTestId('dock-handle');
    await handle.tap();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(await box(notice(page).first())).toEqual(n);
    const sheet = await box(page.locator('.sfh-dock-sheet'));
    expect(sheet.y).toBeGreaterThanOrEqual(n.y + n.height - 0.5);
    const dismiss = notice(page).first().getByRole('button', { name: 'Dismiss' });
    const hit = await dismiss.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(hit).toBe(true);
    await handle.tap();
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
  });
});
