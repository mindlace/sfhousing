// Transit layers e2e (transit spec §7) on fixture-0: 8 stops (7 markers: the two Caltrain platforms
// are one station), the map toolbar's Layers panel (the switches were the header View menu's),
// persistence, a11y.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { newVisitor } from './helpers/game';
import { gotoEditor, gotoHydrated, openHeaderMenu, waitForMap, type Win } from './helpers/sharing';

const visibility = (page: Page, id: string) =>
  page.evaluate(
    (l) => (window as Win).__sfhMap!.map!.getLayoutProperty(l, 'visibility') ?? 'visible',
    id
  );

const layersToggle = (page: Page) => page.getByTestId('map-layers-toggle');
/** Opens the map toolbar's Layers panel (at every width: it is on the map, not in the header). */
const openLayers = async (page: Page) => {
  await layersToggle(page).click();
  await expect(page.getByRole('group', { name: 'Map layers' })).toBeVisible();
};

test('fixture stops load; capacity and stops are off by default', async ({ page }) => {
  await gotoEditor(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const src = (window as Win).__sfhMap!.map!.getSource('transit-stops') as unknown as {
          getData(): Promise<{ features: unknown[] }>;
        };
        return (await src.getData()).features.length;
      })
    )
    .toBe(7);
  expect(await visibility(page, 'transit-access')).toBe('none');
  expect(await visibility(page, 'transit-stops-regional')).toBe('none');
});

test('the Layers panel toggles a layer and the choice survives a reload', async ({ page }) => {
  await gotoEditor(page);
  await openLayers(page);
  await page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' }).check();
  await expect.poll(() => visibility(page, 'transit-access')).toBe('visible');
  await page.keyboard.press('Escape');
  await expect(layersToggle(page)).toBeFocused();
  await expect(page.getByRole('group', { name: 'Map layers' })).toBeHidden();
  await gotoEditor(page);
  await expect.poll(() => visibility(page, 'transit-access')).toBe('visible');
  expect(await visibility(page, 'transit-stops-regional')).toBe('none');
  // Opened again, the stored choice is on.
  await openLayers(page);
  await expect(
    page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' })
  ).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the open Layers panel has no axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoEditor(page);
    await openLayers(page);
    await expect(page.getByRole('checkbox', { name: 'Transit stops' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['[data-testid="map-key-control"]'] });
  });
}

test('there is no Layers toggle when the manifest has no transit, and no View anywhere', async ({
  page
}) => {
  // SSR reads the manifest server-side, so strip it where the intercept applies: the editor load
  // re-runs in the browser on client navigation.
  await page.route('**/data/fixture-0/manifest.json', async (route) => {
    const res = await route.fetch();
    const manifest = (await res.json()) as Record<string, unknown>;
    delete manifest.transit;
    await route.fulfill({ response: res, json: manifest });
  });
  // A new visitor, so `/` holds the brush. A click before hydration is a full page load (SSR sees
  // transit), so the click waits for hydration and the mark proves it was client-side.
  await newVisitor(page);
  await gotoHydrated(page, '/about');
  await page.evaluate(() => ((window as Window & { __spa?: boolean }).__spa = true));
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'SF Housing', exact: true }).click();
  await waitForMap(page);
  expect(await page.evaluate(() => (window as Window & { __spa?: boolean }).__spa)).toBe(true);
  await expect(page.getByTestId('publish-open')).toBeAttached();
  await expect(page.getByTestId('map-key-toggle')).toBeVisible();
  await expect(layersToggle(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View', exact: true })).toHaveCount(0);
});
