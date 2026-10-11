// bench:map (spec §4.12, docs/dev/map-perf.md): a scripted 10 s pan at pitch 55 over downtown
// with a synthetic whole-city plan loaded. Reports rAF frame-time p50/p95; passes at p95 ≤ 16.7 ms.
import { expect, test } from '@playwright/test';
import type { SfhMapDebug } from '../../src/lib/map/debug';

type Win = Window & { __sfhMap?: SfhMapDebug };

const DOWNTOWN = {
  center: [-122.401, 37.789] as [number, number],
  zoom: 15,
  pitch: 55,
  bearing: 0
};
const PAN_MS = 10_000;
const BAR_MS = 16.7;

function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

const verdict = (p95: number): string => (p95 <= BAR_MS ? 'PASS' : 'FAIL');

test('bench:map: 10 s pan over downtown, synthetic whole city', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000
  });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.snapshot());

  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const r = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  });

  const parcels = await page.evaluate(() => (window as Win).__sfhMap!.loadSyntheticCity(1));
  // The controller installs the snapshot in per-frame slices; wait until every cell is in.
  await page.waitForFunction(
    (n) => ((window as Win).__sfhMap!.snapshot()?.cells ?? 0) >= n,
    Math.ceil(parcels / 1500),
    { timeout: 120_000 }
  );

  await page.evaluate(
    (f) =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.jumpTo(f);
      }),
    DOWNTOWN
  );

  // Back and forth east/west so the camera stays over downtown; tiles still load at the edges.
  const deltas = await page.evaluate(
    (ms) =>
      new Promise<number[]>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        const out: number[] = [];
        let start = -1;
        let last = -1;
        const step = (t: number) => {
          if (start < 0) start = last = t;
          else {
            out.push(t - last);
            last = t;
          }
          const el = t - start;
          if (el >= ms) return resolve(out);
          const dir = Math.floor(el / 2500) % 2 === 0 ? 1 : -1;
          map.panBy([dir * 6, 0], { animate: false });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    PAN_MS
  );

  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = pct(sorted, 50);
  const p95 = pct(sorted, 95);
  const line =
    `bench:map frames=${deltas.length} parcels=${parcels} p50=${p50.toFixed(1)}ms ` +
    `p95=${p95.toFixed(1)}ms bar=${BAR_MS}ms ${verdict(p95)} renderer="${renderer}"`;
  console.log(line);
  test.info().annotations.push({ type: 'bench:map', description: line });
  expect(p95, line).toBeLessThanOrEqual(BAR_MS);
});
