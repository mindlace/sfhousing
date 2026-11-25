// /sim's cars (car-ownership Task 12): the Cars row in Details at the playhead, the cars per
// household layer in the map toolbar's Layers panel, and axe over both. fixture-0 carries car data
// (cars.bin, car-zones.json); the VITE_E2E build's debug hooks, never pixels; conditions only.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { slider, waitFilled } from './helpers/run';
import type { Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

async function gotoSim(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

const details = (page: Page): Locator => page.getByTestId('tl-details');
const carsRow = (page: Page): Locator => details(page).getByTestId('tl-cars');
const layersToggle = (page: Page): Locator => page.getByTestId('map-layers-toggle');
const layersGroup = (page: Page): Locator => page.getByRole('group', { name: 'Map layers' });
const carsSwitch = (page: Page): Locator =>
  layersGroup(page).getByRole('checkbox', { name: 'Cars per household' });

async function openDetails(page: Page): Promise<void> {
  await page.getByTestId('score-bar').click();
  await expect(details(page)).toBeVisible();
}

async function openLayers(page: Page): Promise<void> {
  if ((await layersToggle(page).getAttribute('aria-expanded')) !== 'true')
    await layersToggle(page).click();
  await expect(layersGroup(page)).toBeVisible();
}

/** The cars layer's visibility and its source's `v` values, from the map (none before it is up). */
const carsLayer = (page: Page) =>
  page.evaluate(async () => {
    const map = (window as Win).__sfhMap?.map;
    if (!map?.getLayer('cars-per-household')) return { visibility: 'absent', values: [] };
    const src = map.getSource('car-zones') as
      { getData(): Promise<{ features: { properties: { v: number | null } }[] }> } | undefined;
    const data = src ? await src.getData() : { features: [] };
    return {
      visibility: map.getLayoutProperty('cars-per-household', 'visibility') ?? 'visible',
      values: data.features.map((f) => f.properties.v)
    };
  });

/** Moves the playhead to the window's end and waits for the map and Details to read it. */
async function toEnd(page: Page): Promise<void> {
  await slider(page).focus();
  await page.keyboard.press('End');
  await waitFilled(page);
  await expect
    .poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.day))
    .toBeGreaterThan(await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf));
}

test('Details has one Cars row: today, then today to the playhead with the change per household', async ({
  page
}) => {
  await gotoSim(page);
  await openDetails(page);
  await expect(carsRow(page)).toHaveCount(1);
  await expect(carsRow(page)).toContainText('Cars');
  // At today: today's cars alone.
  await expect(carsRow(page)).not.toContainText('→');
  await toEnd(page);
  await expect(carsRow(page)).toContainText('→');
  await expect(carsRow(page)).toContainText(/[+−]\d\.\d\d per household/);
  await expect(carsRow(page)).not.toContainText('NaN');
  // Not in the header or the goal.
  await expect(page.getByTestId('score-bar')).not.toContainText('Cars');
});

test('the Layers panel switches cars per household; the map draws the playhead month', async ({
  page
}) => {
  await gotoSim(page);
  await expect.poll(async () => (await carsLayer(page)).visibility).toBe('none');
  await openLayers(page);
  // Beside transit: after the transit rows, before the height limits.
  await expect(layersGroup(page).locator('label')).toHaveText([
    'Transit stops',
    'Transit capacity within a 10-minute walk',
    'Cars per household',
    'Zoning height limits'
  ]);
  await carsSwitch(page).check();
  await expect.poll(async () => (await carsLayer(page)).visibility).toBe('visible');
  // fixture-0 has three zones; every value is a number or null (no households), never NaN.
  await expect.poll(async () => (await carsLayer(page)).values.length).toBe(3);
  const today = (await carsLayer(page)).values;
  for (const v of today) expect(v === null || Number.isFinite(v)).toBe(true);
  await toEnd(page);
  await expect.poll(async () => (await carsLayer(page)).values.length).toBe(3);
  // The choice survives a reload.
  await gotoSim(page);
  await openLayers(page);
  await expect(carsSwitch(page)).toBeChecked();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`cars: axe clean, ${scheme}, the Layers panel and Details, mid-play`, async ({ page }) => {
    await gotoSim(page, scheme);
    await toEnd(page);
    await openLayers(page);
    await carsSwitch(page).check();
    await expect(page.getByRole('list', { name: 'Cars per household legend' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['[data-testid="map-key-control"]'] });
    await openDetails(page);
    await expect(carsRow(page)).toContainText('per household');
    await expectNoA11yViolations(page, { include: ['[data-testid="tl-details"]'] });
  });
}
