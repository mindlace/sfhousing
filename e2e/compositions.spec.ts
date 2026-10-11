import { expect, test } from '@playwright/test';
import { gotoEditor, paintOnce, type Win, FRAME } from './helpers/sharing';
import { encodeParcelChunk } from '../src/lib/data/parcel-chunk';
import { compositionParcel } from '../src/lib/generator/fixtures/composition-parcel';
for (const theme of ['light', 'dark'] as const)
  for (const stories of [5, 6, 8, 12, 20, 40]) {
    test(`${theme} elevated composition district at ${stories} floors`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await gotoEditor(page);
      const result = await page.evaluate(async (s) => {
        const map = (window as Win).__sfhMap!;
        const result = await map.loadCompositionDistrict(42, s);
        await new Promise<void>((resolve) => {
          map.map!.once('idle', () => resolve());
          map.map!.jumpTo({
            center: [-122.4194, 37.7749],
            zoom: s >= 13 ? 16.3 : 17.3,
            pitch: 55,
            bearing: -20
          });
        });
        return result;
      }, stories);
      expect(result.parcels).toBeGreaterThan(40);
      await page.waitForFunction(() => ((window as Win).__sfhMap!.snapshot()?.pending ?? 1) === 0);
      const totals = await page.evaluate(() => (window as Win).__sfhMap!.generatedParcels());
      expect(totals).toHaveLength(result.parcels);
      expect(totals.every((p) => p.units > 0)).toBe(true);
      await page
        .getByTestId('map-root')
        .screenshot({ path: info.outputPath(`district-${theme}-${stories}.png`) });
    });
  }

test('loaded 500-parcel pointer-up reaches display within 150 ms', async ({ page, isMobile }) => {
  const parcels = Array.from({ length: 500 }, (_, i) => {
    const p = compositionParcel(`loaded-${i}`, 30, 30);
    p.labelPoint = [
      FRAME.center[0] + ((i % 20) - 10) * 0.000001,
      FRAME.center[1] + (Math.floor(i / 20) - 12) * 0.000001
    ];
    return p;
  });
  const body = encodeParcelChunk('fixture-0', '50_25', parcels);
  await page.route('**/parcels/50_25.json', (route) =>
    route.fulfill({ contentType: 'application/json', body })
  );
  await gotoEditor(page);
  await page.waitForFunction(() => !(window as Win).__sfhBrush!.chunks.pending);
  await page.evaluate(() => {
    const w = window as Win & { __displayMs?: number };
    performance.clearMarks('sfh-brush-pointerup');
    const frame = () => {
      const mark = performance.getEntriesByName('sfh-brush-pointerup').at(-1);
      const snapshot = w.__sfhMap!.snapshot();
      if (
        mark &&
        (snapshot?.parts ?? 0) > 0 &&
        Object.values(snapshot!.elevationScale).some((scale) => scale > 0)
      ) {
        requestAnimationFrame(() => {
          w.__displayMs = performance.now() - mark.startTime;
        });
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await paintOnce(page, isMobile);
  await page.waitForFunction(() =>
    Number.isFinite((window as Win & { __displayMs?: number }).__displayMs)
  );
  const ms = await page.evaluate(() => (window as Win & { __displayMs?: number }).__displayMs!);
  console.log(`loaded 500 pointer-up-to-display ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThanOrEqual(150);
  expect(await page.evaluate(() => (window as Win).__sfhMap!.generatedParcels().length)).toBe(500);
});
