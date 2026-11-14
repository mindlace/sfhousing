// bench:map cases for /sim with the timeline docked (timeline-ui R-5, Task 22; docs/dev/map-perf.md):
//  1. the 10 s pan of map-pan.bench.ts over downtown while the timeline plays; rAF frame-time
//     p50/p95, passes at p95 <= 16.7 ms;
//  2. only with SFH_BENCH_DATASET (the live city): the apply time per `cells` installed during the
//     fill, sampled once a frame from the map's debug snapshot;
//  3. the provisional open (OQ-3): an autosaved document with a painted policy is restored, so the
//     page opens it without that policy and then sets the full document; time from navigation to
//     first results (`__sfhFzp.filledThrough >= 0`) and to a whole window
//     (`filledThrough === lastIndex`);
//  4. the same two times for an empty document.
// Numbers are printed as `key=value` lines starting `bench:map`. Needs a display.
import { expect, test, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../../src/lib/fzp/debug';
import type { SfhMapDebug } from '../../src/lib/map/debug';
import type { SimDoc4 } from '../../src/lib/timeline/sim-doc4';
import { BAR_MS, pct, verdict } from './bench-util';

type Win = Window & { __sfhMap?: SfhMapDebug; __sfhFzp?: SfhFzpDebug };

/** The live dataset under bench (`playwright.bench.config.ts`), else fixture-0. */
const LIVE = process.env.SFH_BENCH_DATASET;
const DATASET = LIVE ?? 'fixture-0';
/** The autosave key of the schema 4 document (`SIM_KEY4` in src/lib/timeline/sim-doc4.ts). */
const SIM_KEY = 'sfhousing:sim:v2';

const DOWNTOWN = {
  center: [-122.401, 37.789] as [number, number],
  zoom: 15,
  pitch: 55,
  bearing: 0
};
const PAN_MS = 10_000;
/** Pan speed, scaled by each frame's delta so 60 Hz and 120 Hz displays pan alike. */
const PAN_PX_PER_S = 360;
/** Opens timed per document kind. */
const OPEN_REPS = 3;

// ---- in-page probes ------------------------------------------------------------------------------

/** What the init-script probe records from navigation start (`performance.now()` origin). */
interface Probe {
  /** First frame with `filledThrough >= 0`, ms; null before. */
  first: number | null;
  /** First frame the window is whole by `filledThrough === lastIndex` alone, ms. */
  wholeRaw: number | null;
  /** The same and not stale (the full document's results), ms. */
  whole: number | null;
  /** One entry per frame from the map's timeline: [t, installs, pending, cells]. */
  frames: [number, number, number, number][];
}
type ProbeWin = Win & { __probe?: Probe };

/**
 * Installs, before any page script, a rAF loop that stamps the milestones and (when `frames`)
 * samples the map's timeline snapshot each frame. Stops one frame after the window is whole.
 */
async function installProbe(page: Page, frames: boolean): Promise<void> {
  await page.addInitScript((withFrames) => {
    const w = window as ProbeWin;
    const probe: Probe = { first: null, wholeRaw: null, whole: null, frames: [] };
    w.__probe = probe;
    const tick = (t: number) => {
      const f = w.__sfhFzp;
      if (f) {
        if (probe.first === null && f.filledThrough >= 0) probe.first = t;
        const whole = f.lastIndex >= 0 && f.filledThrough === f.lastIndex;
        if (probe.first !== null && whole && probe.wholeRaw === null) probe.wholeRaw = t;
        if (probe.first !== null && whole && !f.stale && probe.whole === null) probe.whole = t;
      }
      if (withFrames) {
        const s = w.__sfhMap?.timelineSnapshot();
        if (s) probe.frames.push([t, s.installs, s.pending, s.cells]);
      }
      if (probe.whole === null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);
}

/** The probe's milestones once the window is whole. */
async function waitWhole(page: Page): Promise<Probe> {
  await page.waitForFunction(() => (window as ProbeWin).__probe?.whole != null, undefined, {
    timeout: 170_000
  });
  return page.evaluate(() => (window as ProbeWin).__probe!);
}

async function waitMapReady(page: Page): Promise<void> {
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000
  });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
}

// ---- 1. the pan with the timeline docked ----------------------------------------------------------

test('bench:map: /sim timeline docked, pan', async ({ page }) => {
  await page.goto('/sim');
  await waitMapReady(page);
  await page.waitForFunction(() => {
    const f = (window as Win).__sfhFzp;
    return !!f && f.phase === 'ready' && f.lastIndex >= 0 && f.filledThrough === f.lastIndex;
  });
  await page.waitForFunction(() => ((window as Win).__sfhMap!.timelineSnapshot()?.cells ?? 0) > 0, {
    timeout: 60_000
  });

  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const r = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  });
  const dpr = await page.evaluate(() => devicePixelRatio);

  await page.evaluate(
    (f) =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.jumpTo(f);
      }),
    DOWNTOWN
  );
  // Playback runs through the pan: the page's own `setTime` each frame, as when a person plays.
  await page.getByTestId('tl-play').click();
  await expect.poll(() => page.evaluate(() => (window as Win).__sfhFzp!.playing)).toBe(true);

  const deltas = await page.evaluate(
    ({ ms, speed }) =>
      new Promise<number[]>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
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
          const dir = Math.floor(el / 2500) % 2 === 0 ? 1 : -1;
          map.panBy([(dir * speed * dt) / 1000, 0], { animate: false });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { ms: PAN_MS, speed: PAN_PX_PER_S }
  );
  const after = await page.evaluate(() => {
    const s = (window as Win).__sfhMap!.timelineSnapshot();
    return {
      cells: s?.cells ?? 0,
      parts: s?.parts ?? 0,
      playing: (window as Win).__sfhFzp!.playing
    };
  });

  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = pct(sorted, 50);
  const p95 = pct(sorted, 95);
  const line =
    `bench:map case=sim-timeline-docked dataset=${DATASET} frames=${deltas.length} ` +
    `cells=${after.cells} parts=${after.parts} playing=${after.playing} p50=${p50.toFixed(1)}ms ` +
    `p95=${p95.toFixed(1)}ms bar=${BAR_MS}ms ${verdict(p95)} dpr=${dpr} renderer="${renderer}"`;
  console.log(line);
  test.info().annotations.push({ type: 'bench:map', description: line });
  expect(p95, line).toBeLessThanOrEqual(BAR_MS);
});

// ---- 2. apply time per cells during the fill (live city only) --------------------------------------

test('bench:map: /sim fill, apply time per cells', async ({ page }) => {
  test.skip(!LIVE, 'SFH_BENCH_DATASET is not set: fixture-0 has too few cells to time');
  test.setTimeout(300_000);
  await installProbe(page, true);
  await page.goto('/sim');
  const probe = await waitWhole(page);
  // The map and its last slices may trail the window: let them converge before reading.
  await page.waitForFunction(() => (window as Win).__sfhMap?.timelineSnapshot()?.pending === 0);
  const frames = (await page.evaluate(() => (window as ProbeWin).__probe!.frames)).filter(
    (f) => f[0] <= (probe.whole ?? Infinity) + 5_000
  );
  const settled = await page.evaluate(() => (window as Win).__sfhMap!.timelineSnapshot());

  // A frame is busy when slices were queued at its start or cells installed during it; its length
  // is the gap to the next frame. Spans are runs of busy frames.
  const spans: { ms: number; installs: number }[] = [];
  let cur: { ms: number; installs: number } | null = null;
  for (let i = 0; i + 1 < frames.length; i++) {
    const [t, inst, pending] = frames[i];
    const [t2, inst2] = frames[i + 1];
    const busy = pending > 0 || inst2 > inst;
    if (!busy) {
      if (cur) spans.push(cur);
      cur = null;
      continue;
    }
    cur ??= { ms: 0, installs: 0 };
    cur.ms += t2 - t;
    cur.installs += inst2 - inst;
  }
  if (cur) spans.push(cur);
  const totalMs = spans.reduce((a, s) => a + s.ms, 0);
  const installs = spans.reduce((a, s) => a + s.installs, 0);
  const worst = spans.reduce((m, s) => Math.max(m, s.ms), 0);
  const perSpan = spans.map((s) => s.ms / Math.max(1, s.installs));
  const sortedPer = [...perSpan].sort((a, b) => a - b);
  const line =
    `bench:map case=fill-apply dataset=${DATASET} cells=${settled?.cells ?? 0} ` +
    `installs=${installs} busy_spans=${spans.length} busy_ms=${totalMs.toFixed(0)} ` +
    `ms_per_cell=${(totalMs / Math.max(1, installs)).toFixed(2)} ` +
    `span_ms_per_cell_p50=${(sortedPer.length ? pct(sortedPer, 50) : 0).toFixed(2)} ` +
    `span_ms_per_cell_p95=${(sortedPer.length ? pct(sortedPer, 95) : 0).toFixed(2)} ` +
    `longest_span_ms=${worst.toFixed(0)} frames=${frames.length} ` +
    `first_results_ms=${probe.first?.toFixed(0)} whole_ms=${probe.whole?.toFixed(0)}`;
  console.log(line);
  test.info().annotations.push({ type: 'bench:map', description: line });
  expect(installs).toBeGreaterThan(0);
});

// ---- 3 and 4. the provisional open, and an empty open to compare ----------------------------------

/**
 * A schema 4 document with one painted zoning policy (a stroke from the Mission to downtown, so
 * its brush resolves to many lots on the live city) in force from a year after `asOf`.
 */
function paintedDoc(asOf: number): SimDoc4 {
  const from = [-122.419, 37.76];
  const to = [-122.401, 37.789];
  const n = 12;
  const path = Array.from({ length: n }, (_, i) => [
    Math.round((from[0] + ((to[0] - from[0]) * i) / (n - 1)) * 1e6) / 1e6,
    Math.round((from[1] + ((to[1] - from[1]) * i) / (n - 1)) * 1e6) / 1e6
  ]) as [number, number][];
  return {
    schema: 4,
    kind: 'sim',
    datasetVersion: DATASET,
    policy: {
      schema: 4,
      kinds: {
        zoning: [
          {
            id: 'bench-painted',
            label: 'Painted',
            preset: null,
            on: true,
            where: { tag: 'painted' },
            spans: [
              {
                from: asOf + 365,
                to: null,
                what: {
                  tag: 'brushes',
                  brushes: [
                    {
                      id: 'bench-brush',
                      kind: 'paint',
                      stories: 8,
                      strokes: [{ path, radiusM: 300 }]
                    }
                  ]
                }
              }
            ]
          }
        ],
        permitting: [],
        money: []
      }
    }
  };
}

/** `asOf` of the dataset, read from one plain open (it also warms the HTTP cache for the rest). */
async function readAsOf(page: Page): Promise<number> {
  await page.goto('/sim');
  await page.waitForFunction(() => (window as Win).__sfhFzp?.phase === 'ready');
  const asOf = await page.evaluate(() => (window as Win).__sfhFzp!.asOf);
  await page.evaluate((k) => localStorage.removeItem(k), SIM_KEY);
  return asOf;
}

for (const kind of ['painted', 'empty'] as const)
  test(`bench:map: /sim open, ${kind} document`, async ({ page, context }) => {
    test.setTimeout(600_000);
    const asOf = await readAsOf(page);
    await page.close();
    const body = kind === 'painted' ? JSON.stringify(paintedDoc(asOf)) : null;
    const firsts: number[] = [];
    const wholes: number[] = [];
    const wholesRaw: number[] = [];
    let painted = 0;
    for (let rep = 0; rep < OPEN_REPS; rep++) {
      const p = await context.newPage();
      await p.addInitScript(
        ({ key, doc }) => {
          if (doc === null) localStorage.removeItem(key);
          else
            localStorage.setItem(
              key,
              JSON.stringify({ v: 1, savedAt: new Date().toISOString(), plan: doc })
            );
        },
        { key: SIM_KEY, doc: body }
      );
      await installProbe(p, false);
      await p.goto('/sim');
      const probe = await waitWhole(p);
      // The restore took: the page holds the painted policy (the empty case holds none).
      painted = await p.evaluate(
        () =>
          (window as Win).__sfhFzp!.policy.kinds.zoning.filter((z) => z.where.tag === 'painted')
            .length
      );
      firsts.push(probe.first!);
      wholes.push(probe.whole!);
      wholesRaw.push(probe.wholeRaw!);
      await p.close();
    }
    expect(painted).toBe(kind === 'painted' ? 1 : 0);
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    const fmt = (xs: number[]) => `[${xs.map((x) => x.toFixed(0))}]`;
    const line =
      `bench:map case=open-${kind} dataset=${DATASET} reps=${OPEN_REPS} ` +
      `first_results_ms=${med(firsts).toFixed(0)} first_all=${fmt(firsts)} ` +
      `whole_window_ms=${med(wholes).toFixed(0)} whole_all=${fmt(wholes)} ` +
      `whole_raw_ms=${med(wholesRaw).toFixed(0)} whole_raw_all=${fmt(wholesRaw)}`;
    console.log(line);
    test.info().annotations.push({ type: 'bench:map', description: line });
  });
