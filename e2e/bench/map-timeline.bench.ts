// bench:map timeline cases (timelapse-render spec §4.7 and §6, docs/dev/map-perf.md): the same
// 10 s pan as map-pan.bench.ts over downtown with a 30,000-project synthetic whole-city timeline
// loaded, while `setTime` moves every frame. Reports rAF frame-time p50/p95 and the demolish
// pump's largest per-frame operation count; passes at p95 ≤ 16.7 ms.
import { expect, test } from '@playwright/test';
import type { SfhBrushDebug } from '../../src/lib/brush/debug';
import type { SfhMapDebug } from '../../src/lib/map/debug';
import { BAR_MS, pct, verdict } from './bench-util';

type Win = Window & { __sfhMap?: SfhMapDebug; __sfhBrush?: SfhBrushDebug };

const PROJECTS = 30_000;
const DOWNTOWN = {
  center: [-122.401, 37.789] as [number, number],
  zoom: 15.5,
  pitch: 55,
  bearing: 0
};
const PAN_MS = 10_000;
/** Pan speed, scaled by each frame's delta so 60 Hz and 120 Hz displays pan alike. */
const PAN_PX_PER_S = 360;
/** The synthetic timeline's range (src/lib/map/test/synthetic-timeline.ts SYNTHETIC_START/END). */
const DAY_START = 20742;
const DAY_END = 29584;
/** fzp-mode's fastest playback speed, 3 years/s, in simulated days per second. */
const PLAYBACK_DAYS_PER_S = 1095.7;
/** The drag case sweeps the full range once in this long, then back. */
const DRAG_SWEEP_MS = 2000;

/** `daysPerS` is the sweep speed: the day is a triangle wave over [DAY_START, DAY_END]. */
const CASES = [
  { name: 'playback', daysPerS: PLAYBACK_DAYS_PER_S },
  { name: 'drag', daysPerS: (DAY_END - DAY_START) / (DRAG_SWEEP_MS / 1000) }
] as const;

for (const { name, daysPerS } of CASES)
  test(`bench:map: timeline ${name}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
      timeout: 30_000
    });
    await page.waitForFunction(() => !!(window as Win).__sfhMap?.snapshot());
    // The worker host's own revision-0 snapshot (src/lib/sim/display.ts) resets the controller, so
    // let it land before the synthetic timeline goes in.
    await page.waitForFunction(() => !!(window as Win).__sfhBrush?.ready);

    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const r = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return r;
    });
    const dpr = await page.evaluate(() => devicePixelRatio);

    // Each test is a fresh page load, so the pump's `demolishMaxFrameOps` high-water mark starts
    // at 0 for this case. The value read after install is the revision-0 catch-up.
    const { projects, cells } = await page.evaluate(
      (n) => (window as Win).__sfhMap!.loadSyntheticTimeline(1, n),
      PROJECTS
    );
    expect(projects).toBe(PROJECTS);
    // The controller installs the timeline in per-frame slices; wait until every cell is in.
    await page.waitForFunction(
      (n) => ((window as Win).__sfhMap!.timelineSnapshot()?.cells ?? 0) >= n,
      cells,
      { timeout: 120_000 }
    );
    await page.evaluate((d) => (window as Win).__sfhMap!.setTime(d), DAY_START);

    await page.evaluate(
      (f) =>
        new Promise<void>((resolve) => {
          const map = (window as Win).__sfhMap!.map!;
          map.once('idle', () => resolve());
          map.jumpTo(f);
        }),
      DOWNTOWN
    );
    const catchUpOps = await page.evaluate(() => (window as Win).__sfhMap!.demolishMaxFrameOps);

    // Back and forth east/west so the camera stays over downtown (as map-pan). `setTime` runs once
    // per frame, before the pan step.
    const deltas = await page.evaluate(
      ({ ms, speed, start: d0, end: d1, rate }) =>
        new Promise<number[]>((resolve) => {
          const hook = (window as Win).__sfhMap!;
          const map = hook.map!;
          const span = d1 - d0;
          const out: number[] = [];
          let start = -1;
          let last = -1;
          const step = (t: number) => {
            if (start < 0) start = last = t;
            const dt = t - last;
            if (dt > 0) out.push(dt);
            last = t;
            const el = t - start;
            if (el >= ms) return resolve(out);
            const phase = ((rate * el) / 1000) % (2 * span);
            hook.setTime(d0 + (phase <= span ? phase : 2 * span - phase));
            const dir = Math.floor(el / 2500) % 2 === 0 ? 1 : -1;
            map.panBy([(dir * speed * dt) / 1000, 0], { animate: false });
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      { ms: PAN_MS, speed: PAN_PX_PER_S, start: DAY_START, end: DAY_END, rate: daysPerS }
    );

    // Nothing (e.g. a late worker snapshot) replaced the synthetic timeline during the pan.
    const after = await page.evaluate(() => {
      const m = (window as Win).__sfhMap!;
      const s = m.timelineSnapshot();
      return { cells: s?.cells ?? 0, parts: s?.parts ?? 0, pumpMaxOps: m.demolishMaxFrameOps };
    });
    expect(after.cells).toBe(cells);
    // The pump actually ran: playback and drag both cross demolition days.
    expect(after.pumpMaxOps).toBeGreaterThan(0);

    const sorted = [...deltas].sort((a, b) => a - b);
    const p50 = pct(sorted, 50);
    const p95 = pct(sorted, 95);
    const line =
      `bench:map timeline=${name} frames=${deltas.length} projects=${projects} ` +
      `p50=${p50.toFixed(1)}ms parts=${after.parts} p95=${p95.toFixed(1)}ms ` +
      `pumpMaxOps=${after.pumpMaxOps} (catch-up ${catchUpOps}) bar=${BAR_MS}ms ${verdict(p95)} ` +
      `dpr=${dpr} renderer="${renderer}"`;
    console.log(line);
    test.info().annotations.push({ type: 'bench:map', description: line });
    expect(p95, line).toBeLessThanOrEqual(BAR_MS);
  });
