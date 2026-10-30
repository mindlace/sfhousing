// Transit layers e2e (transit spec §7) on fixture-0: 8 stops (7 markers: the two Caltrain platforms
// are one station), View menu, persistence, a11y.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import { gotoEditor, headerAction, waitForMap, type Win } from './helpers/sharing';

const visibility = (page: Page, id: string) =>
  page.evaluate(
    (l) => (window as Win).__sfhMap!.map!.getLayoutProperty(l, 'visibility') ?? 'visible',
    id
  );

const viewButton = (page: Page) => page.getByRole('button', { name: 'View', exact: true });
/** Opens the View menu (below 768 px its button waits in the header Menu). */
const openView = async (page: Page) => (await headerAction(page, 'View')).click();

test('fixture stops load; capacity is on and stops are off by default', async ({ page }) => {
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
  expect(await visibility(page, 'transit-access')).toBe('visible');
  expect(await visibility(page, 'transit-stops-regional')).toBe('none');
});

test('the View menu toggles a layer and the choice survives a reload', async ({ page }) => {
  await gotoEditor(page);
  await openView(page);
  await page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' }).uncheck();
  await expect.poll(() => visibility(page, 'transit-access')).toBe('none');
  await page.keyboard.press('Escape');
  await expect(viewButton(page)).toBeFocused();
  await gotoEditor(page);
  await expect.poll(() => visibility(page, 'transit-access')).toBe('none');
  expect(await visibility(page, 'transit-stops-regional')).toBe('none');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the open View menu has no axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoEditor(page);
    await openView(page);
    await expect(page.getByRole('group', { name: 'Map layers' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['header'] });
  });
}

test('the View button is hidden when the manifest has no transit', async ({ page }) => {
  // SSR reads the manifest server-side, so strip it where the intercept applies: the editor load
  // re-runs in the browser on client navigation.
  await page.route('**/data/fixture-0/manifest.json', async (route) => {
    const res = await route.fetch();
    const manifest = (await res.json()) as Record<string, unknown>;
    delete manifest.transit;
    await route.fulfill({ response: res, json: manifest });
  });
  // A click before hydration is a full page load (SSR sees transit); retry until it is client-side.
  await expect(async () => {
    await page.goto('/attribution');
    await page.evaluate(() => ((window as Window & { __spa?: boolean }).__spa = true));
    await page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' }).click();
    await waitForMap(page);
    expect(await page.evaluate(() => (window as Window & { __spa?: boolean }).__spa)).toBe(true);
  }).toPass({ timeout: 25_000 });
  await expect(page.getByTestId('publish-open')).toBeAttached();
  await expect(viewButton(page)).toHaveCount(0);
});
