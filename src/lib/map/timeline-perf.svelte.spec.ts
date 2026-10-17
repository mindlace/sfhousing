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
  return { single: p95(single), batched: p95(batched) };
}

const us = (ms: number) => (ms * 1000).toFixed(3);

describe('timeline perf (real map)', { timeout: 600_000 }, () => {
  it('setTime p95 ≤ 0.05 ms per call at 300 and at 30,000 projects, ratio ≤ 1.5', async () => {
    const { h, map } = await mountReady();
    // setTime's cost is main-thread JS: skip deck's draw (SwiftShader still takes ~250 ms a frame
    // to shade 30,000 projects' vertices off screen). Layers, the pump and MapLibre run as usual.
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
    const med = (runs: Run[], k: keyof Run) => median(runs.map((x) => x[k]));
    const [s300, s30k] = [med(small, 'single'), med(large, 'single')];
    const [b300, b30k] = [med(small, 'batched'), med(large, 'batched')];
    console.info(
      `[timeline-perf] setTime p95 per call, ${SAMPLES} samples/run, median of 3 runs: ` +
        `single 300 = ${us(s300)} µs, 30k = ${us(s30k)} µs; ` +
        `batched (${calls} calls) 300 = [${small.map((x) => us(x.batched))}] µs, ` +
        `30k = [${large.map((x) => us(x.batched))}] µs, ratio ${(b30k / b300).toFixed(2)}`
    );
    expect(s300).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(s30k).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(b300).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(b30k).toBeLessThanOrEqual(SET_TIME_P95_MS);
    expect(b30k / b300).toBeLessThanOrEqual(SET_TIME_RATIO);
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
