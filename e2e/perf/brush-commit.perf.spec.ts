// Wall-clock budget, so it runs alone: the chromium-perf / mobile-perf projects start only after
// the parallel chromium and mobile projects finish (see playwright.config.ts). The behaviour of
// the same stroke (its announcement, the op, the buildings) is asserted in e2e/brush.spec.ts.
import { expect, test } from '@playwright/test';
import {
  FRAME,
  FROM,
  TO,
  gotoEditor,
  jumpAndIdle,
  mouseDrag,
  ops,
  type Win
} from '../helpers/sharing';

type Timed = Win & { __sfhUpAt?: number };

// Brush spec §6.1 and §4.5: from `pointerup` to map-view applying the stroke's `phase:'commit'`
// diff, ≤ 150 ms on fixture-0's parcel row.
test('a desktop stroke: pointer-up to the commit diff applied within 150 ms', async ({
  page,
  isMobile
}) => {
  // A mouse stroke, as in brush.spec's paint test; the touch path is loaded-500's.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(isMobile, 'desktop stroke');
  await gotoEditor(page);
  await jumpAndIdle(page, FRAME);
  // The span starts at the event's own time, so time the event spent queued behind other work on
  // the main thread counts. The app's `sfh-brush-pointerup` mark is set later, in the handler,
  // once the editor has taken the op.
  await page.evaluate(() =>
    window.addEventListener(
      'pointerup',
      (e) => {
        (window as Timed).__sfhUpAt = e.timeStamp;
      },
      { capture: true }
    )
  );

  await mouseDrag(page, FROM, TO);
  await expect.poll(() => ops(page)).toBe(1);
  await page.waitForFunction(
    () => performance.getEntriesByName('sfh-brush-commit-applied', 'mark').length > 0
  );
  const { span, measured } = await page.evaluate(() => {
    const applied = performance.getEntriesByName('sfh-brush-commit-applied', 'mark').at(-1)!;
    const measure = performance.getEntriesByName('sfh-brush-commit', 'measure').at(-1);
    return {
      span: applied.startTime - (window as Timed).__sfhUpAt!,
      measured: measure?.duration ?? null
    };
  });
  console.log(
    `brush commit pointer-up-to-applied ${span.toFixed(1)} ms (app measure ${measured} ms)`
  );
  expect(measured).not.toBeNull();
  expect(span).toBeLessThanOrEqual(150);
});
