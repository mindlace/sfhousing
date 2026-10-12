// Explicitly fixture-only visual evidence; never substitutes for the real roof benchmark.
import { expect, test } from '@playwright/test';
import { gotoEditor, jumpAndIdle, projectToPage } from '../helpers/sharing';
import type {} from '../../src/lib/map/debug';
import { roofGpuCapability } from '../../scripts/roof-gpu-capability';

test('fixture courtyard: unmatched piece survives real editing and Undo', async ({
  page
}, info) => {
  // eslint-disable-next-line playwright/no-skipped-test -- Separate opt-in fixture evidence.
  test.skip(process.env.BENCH_FIXTURE_VISUALS !== '1', 'Explicit fixture visual opt-in');
  expect(process.env.BENCH_DATASET_VERSION ?? 'fixture-0').toBe('fixture-0');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await gotoEditor(page);
  const gpu = await page.evaluate(roofGpuCapability);
  expect(gpu.parallel).toBe(true);
  expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|Software/);
  const at: [number, number] = [-122.418875, 37.760135];
  await jumpAndIdle(page, { center: at, zoom: 18, pitch: 0, bearing: 0 });
  const unmatched = 'p-39caa3c6bea85d194a88807b';
  const state = () =>
    page.evaluate((id) => {
      const map = window.__sfhMap!.map!;
      const feature = map
        .querySourceFeatures('buildings', { sourceLayer: 'buildings' })
        .find((f) => f.id === id);
      const point = map.project([-122.418875, 37.760135]);
      return {
        feature: feature ? { properties: feature.properties, geometry: feature.geometry } : null,
        visible: map.queryRenderedFeatures().some((f) => f.source === 'buildings' && f.id === id),
        coversHole: map
          .queryRenderedFeatures(point)
          .some((f) => f.source === 'buildings' && f.id === id),
        flags: map.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id })
      };
    }, unmatched);
  await expect.poll(async () => (await state()).feature?.geometry.type).toBe('Polygon');
  const before = await state();
  expect(before.feature?.properties.parcelId ?? '').toBe('');
  expect(before.visible).toBe(true);
  expect(before.coversHole).toBe(false);
  expect(
    before.feature?.geometry.type === 'Polygon' ? before.feature.geometry.coordinates.length : 0
  ).toBe(2);
  const shot = async (name: string) => {
    const path = `/tmp/sfh-roof-FIXTURE-courtyard-${name}.png`;
    await info.attach(`FIXTURE courtyard ${name}`, {
      body: await page.getByTestId('map-root').screenshot({ path }),
      contentType: 'image/png'
    });
    console.log('FIXTURE_COURTYARD_VISUAL', name, path);
  };
  await shot('before');
  await page.getByRole('radio', { name: 'Paint', exact: true }).click();
  await page.getByRole('button', { name: '20 stories', exact: true }).click();
  await page.getByRole('slider', { name: /^Brush/ }).press('Home');
  const [x, y] = await projectToPage(page, [-122.4189155, 37.760135]);
  await page.mouse.click(x, y);
  await expect
    .poll(() => page.evaluate(() => window.__sfhMap!.generatedParcels().map((p) => p.parcelId)))
    .toContain('3512006');
  expect(await page.evaluate(() => window.__sfhMap!.hiddenIds())).toContain('3512006');
  expect((await state()).flags.replaced).not.toBe(true);
  await shot('generated');
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect.poll(() => page.evaluate(() => window.__sfhMap!.generatedParcels())).toEqual([]);
  expect(await page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual([]);
  await shot('Undo');
});
