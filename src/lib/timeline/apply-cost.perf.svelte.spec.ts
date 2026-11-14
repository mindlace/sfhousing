// Cost of applying one fill update (timeline-ui R-5, Task 22): the real SimMap on the fixture
// manifest with playback running (`setTime` every frame), one `TimelineUpdate` of K = 22 cells and
// of K = 121 cells (synthetic, src/lib/map/test/synthetic-timeline.ts), timed from `applyTimeline`
// until `debugSnapshot().pending === 0`. Median of 5 each, printed as one parseable line. Numbers
// are reported, never asserted: the only assertion is that `pending` reaches 0.
//
// Each update is an incremental revision (revision = last + 1, as a fill sends) whose cells replace
// the installed cells of the same ids, alternating between two seeds so every apply swaps content.
// `demolish` is empty: this times the cell install, not the demolish pump (timeline.perf covers it).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Deck } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from '../map/SimMap.svelte';
import {
  SYNTHETIC_END,
  SYNTHETIC_LOOKUPS,
  SYNTHETIC_START,
  makeSyntheticTimeline
} from '../map/test/synthetic-timeline';
import type { SimMapHandle, TimelineUpdate } from '../map/types';

// See SimMap.svelte.spec.ts: the committed fixture dataset is served by Vitest's dev server.
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

/** The two update sizes, in cells. */
const KS = [22, 121] as const;
/** Projects per cell (a test value: the generator's default of 1500 would be 181,500 at K = 121). */
const PER_CELL = 500;
/** Timed applies per size. */
const RUNS = 5;
/** fzp-mode's fastest speed, 3 years/s, at 60 frames/s: the days one frame advances. */
const DAYS_PER_FRAME = (3 * 365.2425) / 60;
/** Open water west of the SF bbox: every layer still draws, nothing covers the screen. */
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
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

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
  map.jumpTo({ center: OFF_CITY, zoom: 17, pitch: 0, bearing: 0 });
  return h;
}

/** `setTime` every animation frame until the returned function is called (playback at 3 years/s). */
function startPlayback(h: SimMapHandle): () => void {
  let running = true;
  let day = SYNTHETIC_START;
  const tick = () => {
    if (!running) return;
    h.setTime(day);
    day += DAYS_PER_FRAME;
    if (day > SYNTHETIC_END) day = SYNTHETIC_START;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
  };
}

/** Frames waited at most for one apply to converge. */
const MAX_FRAMES = 20_000;

/** Applies `u` and returns the ms until its revision is in and `pending === 0`. */
async function applyTimed(h: SimMapHandle, u: TimelineUpdate): Promise<number> {
  const t0 = performance.now();
  h.applyTimeline(u);
  for (let f = 0; f < MAX_FRAMES; f++) {
    const s = dbg().timelineSnapshot();
    if (s && s.revision === u.revision && s.pending === 0) return performance.now() - t0;
    await nextFrame();
  }
  throw new Error(`apply of revision ${u.revision} did not converge`);
}

describe('apply cost (real map, playback running)', { timeout: 900_000 }, () => {
  it('times one fill update of 22 and of 121 cells until pending is 0', async () => {
    const h = await mountReady();
    h.setTime(SYNTHETIC_START);
    h.setTimelineLookups(SYNTHETIC_LOOKUPS);
    const stop = startPlayback(h);
    const medians: Record<number, number> = {};
    const samples: Record<number, string[]> = {};
    try {
      for (const k of KS) {
        const a = makeSyntheticTimeline(1, k * PER_CELL, PER_CELL);
        const b = makeSyntheticTimeline(2, k * PER_CELL, PER_CELL);
        expect(a.cells.length).toBe(k);
        // The base: K cells of seed 1 as a revision 0 snapshot, settled before timing.
        h.applyTimeline({ ...a, demolish: [] });
        await expect.poll(() => dbg().timelineSnapshot()?.cells, { timeout: 120_000 }).toBe(k);
        await expect
          .poll(() => dbg().timelineSnapshot()?.pending, { timeout: 120_000, interval: 50 })
          .toBe(0);
        const ms: number[] = [];
        for (let r = 0; r < RUNS; r++) {
          const next = r % 2 === 0 ? b : a;
          const revision = dbg().timelineSnapshot()!.revision + 1;
          ms.push(await applyTimed(h, { ...next, revision, demolish: [] }));
        }
        medians[k] = median(ms);
        samples[k] = ms.map((x) => x.toFixed(1));
        // Pending reached 0 for every timed apply (applyTimed throws otherwise).
        expect(dbg().timelineSnapshot()!.pending).toBe(0);
      }
    } finally {
      stop();
    }
    console.info(
      `[apply-cost] perCell=${PER_CELL} runs=${RUNS} ` +
        KS.map(
          (k) => `k${k}_median_ms=${medians[k].toFixed(1)} k${k}_samples_ms=[${samples[k]}]`
        ).join(' ')
    );
  });
});
