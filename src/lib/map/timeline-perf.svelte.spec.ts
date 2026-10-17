// Timeline client budgets (timelapse-render spec §4.5, §4.7, §6 "timeline-perf"): `setTime` at
// 300 and 30,000 projects, the 2,000-op demolish pump frame and the 30,000-bar declutter. The map
// is real (fixture manifest); timelines go in through the debug hook's loadSyntheticTimeline,
// which calls SimMap's handle functions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Deck } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { SLICE_IDS } from './hide';
import { buildBars } from './timelapse/bars';
import { StageBarLayer, TimelapseExtension } from './timelapse/deck';
import { declutter } from './timelapse/declutter';
import {
  SYNTHETIC_END,
  SYNTHETIC_LOOKUPS,
  SYNTHETIC_START,
  makeSyntheticTimeline
} from './test/synthetic-timeline';
import type { SimMapHandle } from './types';

// See SimMap.svelte.spec.ts: the committed fixture dataset is served by Vitest's dev server.
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

/** §4.7 pass bars. */
const SET_TIME_P95_MS = 0.05;
const SET_TIME_RATIO = 1.5;
/** §4.5 pass bar: the C5 slice budget. */
const PUMP_FRAME_MS = 8;
/** §4.7 pass bar: per-frame map-view JS during playback with no demolitions crossing. */
const FRAME_JS_MS = 0.5;
/** §6 client budget. */
const DECLUTTER_MS = 20;

/** Timed `setTime` samples per run, of each kind (single calls and batches). */
const SAMPLES = 2000;
/**
 * Samples between animation frames. The first call after each frame arms the pump's frame and
 * MapLibre's repaint, as one call per frame does in playback; the rest coalesce.
 */
const SAMPLES_PER_FRAME = 10;
/** fzp-mode's fastest speed, 3 years/s, at 60 frames/s: the days one frame advances. */
const DAYS_PER_FRAME = (3 * 365.2425) / 60;

/** Open water west of the SF bbox. */
const OFF_CITY: [number, number] = [-122.6, 37.9];
/** Near the synthetic grid's south-west corner: a few hundred sites at zoom 16 at either size. */
const CITY_CORNER: [number, number] = [-122.5, 37.712];
/** Playback frames timed per size. */
const PLAYBACK_FRAMES = 120;

let hosts: HTMLElement[] = [];

beforeEach(() => {
  vi.stubEnv('VITE_E2E', '1'); // installs window.__sfhMap (debug.ts)
});

afterEach(() => {
  for (const h of hosts) h.remove();
  hosts = [];
  vi.unstubAllEnvs();
});

const dbg = () => window.__sfhMap!;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function overlayOf(map: MapLibreMap): MapLibreOverlay {
  const controls = (map as unknown as { _controls: unknown[] })._controls;
  return controls.find((c) => c instanceof MapLibreOverlay) as MapLibreOverlay;
}
const deckOf = (map: MapLibreMap) => (overlayOf(map) as unknown as { _deck: Deck })._deck;

async function mountReady() {
  const target = document.createElement('div');
  target.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(target);
  hosts.push(target);
  let resolveReady!: (h: SimMapHandle) => void;
  const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
  await render(SimMap, { target, props: { manifest, onready: (h) => resolveReady(h) } });
  const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
  await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('ready');
  const h = await ready;
  const map = h.getMap()!;
  await expect.poll(() => deckOf(map).isInitialized, { timeout: 10_000 }).toBe(true);
  // The budgets are main-thread JS. Headless Chromium draws with SwiftShader, which rasterises
  // on the CPU: a whole-city view of 30,000 projects takes ~10 s a frame, so look at open water
  // west of the synthetic city instead (every layer still draws; nothing covers the screen).
  map.jumpTo({ center: OFF_CITY, zoom: 17, pitch: 0, bearing: 0 });
  return { h, map };
}

/** Slices installed and the demolish pump caught up. */
async function converged() {
  await expect
    .poll(() => dbg().timelineSnapshot()?.pending, { timeout: 60_000, interval: 50 })
    .toBe(0);
}

/** Loads a synthetic timeline at Day 20742 through the hook and waits for it to converge. */
async function load(h: SimMapHandle, n: number) {
  h.setTime(SYNTHETIC_START);
  const r = await dbg().loadSyntheticTimeline(1, n);
  expect(r.projects).toBe(n);
  await expect.poll(() => dbg().timelineSnapshot()?.cells, { timeout: 60_000 }).toBe(r.cells);
  await converged();
}

const p95 = (xs: Float64Array) => {
  const s = Float64Array.from(xs).sort();
  return s[Math.ceil(0.95 * s.length) - 1];
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/**
 * Calls per batch. performance.now() is clamped to 100 µs here (the Vitest page is not
 * cross-origin isolated), far above one call. A single-call reading is 0 or one tick, so its
 * p95 meets 0.05 ms only when fewer than 5% of calls straddle a tick: a stricter bar than the
 * budget, but no ratio. A batch times `calls` consecutive calls and divides, with `calls` set so
 * a batch lasts about 1 ms (10 ticks); the ratio uses batches.
 */
function callsPerBatch(h: SimMapHandle): number {
  let n = 0;
  const t0 = performance.now();
  let day = SYNTHETIC_START;
  while (performance.now() - t0 < 5) {
    for (let i = 0; i < 100; i++) h.setTime((day += 0.001));
    n += 100;
  }
  h.setTime(SYNTHETIC_START);
  return Math.max(100, Math.ceil(n / 5));
}

interface Run {
  /** p95 of SAMPLES single calls, ms (clamped readings). */
  single: number;
  /** p95 over SAMPLES batches of the mean per-call time, ms. */
  batched: number;
  /**
   * The single readings taken first after a frame (the armed path: the pump's rAF and MapLibre's
   * repaint), ms. A clamped reading with a random tick phase is unbiased, so their mean
   * estimates the true cost.
   */
  armed: number[];
}

/**
 * One run from Day 20742, advancing the day as playback at 3 years/s does: SAMPLES single timed
 * calls, each followed by a batch, with an animation frame every SAMPLES_PER_FRAME samples.
 */
async function setTimeRun(h: SimMapHandle, calls: number): Promise<Run> {
  const single = new Float64Array(SAMPLES);
  const batched = new Float64Array(SAMPLES);
  const step = DAYS_PER_FRAME / ((calls + 1) * SAMPLES_PER_FRAME);
  let day = SYNTHETIC_START;
  for (let i = 0; i < SAMPLES; i++) {
    if (i % SAMPLES_PER_FRAME === 0) await nextFrame();
    let t0 = performance.now();
    h.setTime(day);
    single[i] = performance.now() - t0;
    day += step;
    t0 = performance.now();
    for (let k = 0; k < calls; k++) {
      h.setTime(day);
      day += step;
    }
    batched[i] = (performance.now() - t0) / calls;
  }
  // Back to the start for the next run; the pump unwinds before it begins.
  h.setTime(SYNTHETIC_START);
  await converged();
  const armed: number[] = [];
  for (let i = 0; i < SAMPLES; i += SAMPLES_PER_FRAME) armed.push(single[i]);
  return { single: p95(single), batched: p95(batched), armed };
}

const us = (ms: number) => (ms * 1000).toFixed(3);

/** Mean and its standard error. */
function meanSe(xs: number[]): { mean: number; se: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, se: Math.sqrt(v / xs.length) };
}

describe('timeline perf (real map)', { timeout: 600_000 }, () => {
  it('setTime p95 ≤ 0.05 ms per call at 300 and at 30,000 projects, ratio ≤ 1.5', async () => {
    const { h, map } = await mountReady();
    // setTime's cost is main-thread JS: skip deck's draw (SwiftShader still takes ~250 ms a frame
    // at 30,000 projects, even off screen). This replaces SimMap's own layerFilter (cell culling)
    // for this test only. Layers, the pump and MapLibre run as usual; the per-frame draw JS has
    // its own test below.
    overlayOf(map).setProps({ layerFilter: () => false });
    await load(h, 300);
    const calls = callsPerBatch(h);
    await setTimeRun(h, calls); // warm-up: JIT and first-frame costs, discarded
    const small: Run[] = [];
    for (let r = 0; r < 3; r++) small.push(await setTimeRun(h, calls));
    await load(h, 30_000);
    expect(dbg().timelineSnapshot()!.demolish.total).toBeGreaterThan(SLICE_IDS);
    const large: Run[] = [];
    for (let r = 0; r < 3; r++) large.push(await setTimeRun(h, calls));
    const med = (runs: Run[], k: 'single' | 'batched') => median(runs.map((x) => x[k]));
    const [s300, s30k] = [med(small, 'single'), med(large, 'single')];
    const [b300, b30k] = [med(small, 'batched'), med(large, 'batched')];
    // Armed path: only 1 call a frame, of a few µs, so most clamped readings are 0 and a few one
    // tick. The 600 readings per size (3 runs) are pooled, and the ratio bar is tested one-sided
    // at 3 standard errors: a30k − 1.5 · a300 ≤ 3 · SE. A bare ratio of two such means is
    // dominated by counting noise (0/x or x/0) and would flake either way.
    const a300 = meanSe(small.flatMap((x) => x.armed));
    const a30k = meanSe(large.flatMap((x) => x.armed));
    const excess = a30k.mean - SET_TIME_RATIO * a300.mean;
    const excessSe = Math.hypot(a30k.se, SET_TIME_RATIO * a300.se);
    console.info(
      `[timeline-perf] setTime p95 per call, ${SAMPLES} samples/run, median of 3 runs: ` +
        `single 300 = ${us(s300)} µs, 30k = ${us(s30k)} µs; ` +
        `batched (${calls} calls) 300 = [${small.map((x) => us(x.batched))}] µs, ` +
        `30k = [${large.map((x) => us(x.batched))}] µs, ratio ${(b30k / b300).toFixed(2)}; ` +
        `armed mean 300 = ${us(a300.mean)} ± ${us(a300.se)} µs, ` +
        `30k = ${us(a30k.mean)} ± ${us(a30k.se)} µs, ratio ${(a30k.mean / a300.mean).toFixed(2)}`
    );
    expect(s300).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(s30k).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(b300).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(b30k).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(b30k / b300).toBeLessThanOrEqual(SET_TIME_RATIO);
    expect(a300.mean).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(a30k.mean).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(excess).toBeLessThanOrEqual(3 * excessSe);
  });

  it('a pump frame with 2,000 feature-state operations takes ≤ 8 ms', async () => {
    const { h } = await mountReady();
    await load(h, 30_000);
    const { total, applied } = dbg().timelineSnapshot()!.demolish;
    expect(applied).toBe(0);
    expect(total).toBeGreaterThanOrEqual(SLICE_IDS);
    performance.clearMeasures('sfh-pump');
    h.setTime(SYNTHETIC_END); // one jump across every entry
    await converged();
    expect(dbg().timelineSnapshot()!.demolish.applied).toBe(total);
    expect(dbg().demolishMaxFrameOps).toBe(SLICE_IDS);
    const frames = performance.getEntriesByName('sfh-pump', 'measure').map((e) => e.duration);
    expect(frames.length).toBe(Math.ceil(total / SLICE_IDS));
    console.info(
      `[timeline-perf] pump: ${total} entries in ${frames.length} frames; first ` +
        `${frames[0].toFixed(2)} ms, max ${Math.max(...frames).toFixed(2)} ms`
    );
    expect(frames[0]).toBeLessThanOrEqual(PUMP_FRAME_MS);
    expect(Math.max(...frames)).toBeLessThanOrEqual(PUMP_FRAME_MS);
  });
});

/**
 * Wraps `draw` on a prototype so every call adds its duration to `acc.ms`. Restored by the
 * returned function.
 */
function timeDraws(proto: { draw: (...a: never[]) => unknown }, acc: { ms: number; n: number }) {
  const orig = proto.draw;
  proto.draw = function (this: unknown, ...a: never[]) {
    const t0 = performance.now();
    const r = orig.apply(this, a);
    acc.ms += performance.now() - t0;
    acc.n++;
    return r;
  };
  return () => {
    proto.draw = orig;
  };
}

describe('timeline perf (per-frame JS)', { timeout: 600_000 }, () => {
  // §4.7 "per-frame map-view JS during playback with no demolitions crossing ≤ 0.5 ms". The
  // timeline-attributable JS of one frame: the frame's setTime plus every TimelapseExtension.draw
  // (one per timeline layer, both passes) and StageBarLayer.draw in the render it causes.
  // Measured by wrapping the two prototypes' draw in the test, not by a gated
  // performance.measure in the code: 40+ measure entries a frame would allocate inside the
  // very draws being timed, and the wrap needs no production change. deck's and luma's own
  // draw JS (layer iteration, SolidPolygonLayer's model.draw) is not timeline code here and is
  // left to bench:map on a real GPU (Task 14), as is the frame's GPU time.
  // Deck draws with SimMap's own layerFilter (generatedCellFilter culls cells out of view); the
  // camera sits on a corner of the synthetic city, so SwiftShader rasterises little, while every
  // cell stays installed. The frame therefore draws the visible cells' two passes and the bars.
  // `demolish` is emptied so no frame crosses a demolition, and playback runs at 3 years/s from
  // Day 20742.
  // Timer caveat: each reading is clamped to 100 µs ticks, so a frame's sum of its ~4 readings
  // (setTime, the visible cells' extension draws, the bars) is unbiased but noisy; the max over
  // frames is asserted as §4.7 states it.
  it('per-frame timeline JS ≤ 0.5 ms during playback at 300 and 30,000 projects', async () => {
    const { h, map } = await mountReady();
    map.jumpTo({ center: CITY_CORNER, zoom: 16, pitch: 0, bearing: 0 });
    const ext = { ms: 0, n: 0 };
    const bars = { ms: 0, n: 0 };
    const restore = [
      timeDraws(TimelapseExtension.prototype, ext),
      timeDraws(StageBarLayer.prototype, bars)
    ];
    const playback = async (n: number) => {
      const u = makeSyntheticTimeline(1, n);
      h.setTime(SYNTHETIC_START);
      h.setTimelineLookups(SYNTHETIC_LOOKUPS);
      h.applyTimeline({ ...u, demolish: [] });
      await expect
        .poll(() => dbg().timelineSnapshot()?.cells, { timeout: 60_000 })
        .toBe(u.cells.length);
      await converged();
      expect(dbg().timelineSnapshot()!.demolish.total).toBe(0);
      // Let deck finish any deferred work on the new layers before timing.
      for (let i = 0; i < 10; i++) await nextFrame();
      const frames: number[] = [];
      /** setTime / extension draws / bar draw, ms, per frame. */
      const parts: [number, number, number][] = [];
      const draws: number[] = [];
      let day = SYNTHETIC_START;
      let setTimeMs = 0;
      for (let f = 0; f <= PLAYBACK_FRAMES; f++) {
        await nextFrame();
        // The window since the last tick holds the render the previous setTime asked for.
        if (f > 0) {
          frames.push(setTimeMs + ext.ms + bars.ms);
          parts.push([setTimeMs, ext.ms, bars.ms]);
          draws.push(ext.n + bars.n);
        }
        ext.ms = ext.n = bars.ms = bars.n = 0;
        const t0 = performance.now();
        h.setTime(day);
        setTimeMs = performance.now() - t0;
        day += DAYS_PER_FRAME;
      }
      return { frames, parts, draws, layers: dbg().timelineSnapshot()!.layerIds.length };
    };
    try {
      const small = await playback(300);
      const large = await playback(30_000);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const report = (r: typeof small) =>
        `layers ${r.layers}, draws/frame ${Math.min(...r.draws)}–${Math.max(...r.draws)}, ` +
        `mean ${mean(r.frames).toFixed(3)} ms, max ${Math.max(...r.frames).toFixed(3)} ms ` +
        `(setTime/extension/bars ${r.parts[r.frames.indexOf(Math.max(...r.frames))].map((x) => x.toFixed(1)).join('/')})`;
      console.info(
        `[timeline-perf] per-frame timeline JS over ${PLAYBACK_FRAMES} frames: ` +
          `300: ${report(small)}; 30k: ${report(large)}; ` +
          `mean ratio ${(mean(large.frames) / mean(small.frames)).toFixed(2)}`
      );
      // Every frame rendered: at least one cell's solid and ghost passes plus the bars.
      for (const r of [small, large]) expect(Math.min(...r.draws)).toBeGreaterThanOrEqual(3);
      expect(large.layers).toBe(41);
      expect(Math.max(...small.frames)).toBeLessThanOrEqual(FRAME_JS_MS);
      expect(Math.max(...large.frames)).toBeLessThanOrEqual(FRAME_JS_MS);
    } finally {
      for (const r of restore) r();
    }
  });
});

describe('timeline perf (CPU)', { timeout: 120_000 }, () => {
  it('declutters 30,000 bars of the synthetic city in ≤ 20 ms (best of 3)', () => {
    const all = buildBars(makeSyntheticTimeline(2, 30_000).cells, SYNTHETIC_LOOKUPS);
    expect(all.length).toBeGreaterThanOrEqual(30_000);
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const bars = all.slice(0, 30_000).map((b) => ({ ...b }));
      const t0 = performance.now();
      declutter(bars);
      times.push(performance.now() - t0);
    }
    console.info(`[timeline-perf] declutter 30,000 bars: [${times.map((t) => t.toFixed(1))}] ms`);
    expect(Math.min(...times)).toBeLessThanOrEqual(DECLUTTER_MS);
  });
});
