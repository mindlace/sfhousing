// Wall-clock budget, so it runs alone: the chromium-perf / mobile-perf projects start only after
// the parallel chromium and mobile projects finish (see playwright.config.ts).
import { expect, test } from '@playwright/test';
import { gotoEditor, paintOnce, type Win, FRAME } from '../helpers/sharing';
import { encodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { compositionParcel } from '../../src/lib/generator/fixtures/composition-parcel';

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
