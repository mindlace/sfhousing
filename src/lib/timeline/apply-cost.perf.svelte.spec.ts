// Cost of applying one fill update (timeline-ui R-5, Task 22): the real SimMap on the fixture
// manifest with playback running (`setTime` every frame), one `TimelineUpdate` of K = 22 cells and
// of K = 121 cells (synthetic, src/lib/map/test/synthetic-timeline.ts), timed from `applyTimeline`
// until `debugSnapshot().pending === 0`. Median of 5 each, printed as one parseable line. Numbers
// are reported, never asserted: the only assertion is that `pending` reaches 0.
//
// Each update is an incremental revision (revision = last + 1, as a fill sends) whose cells replace
// the installed cells of the same ids, alternating between two seeds so every apply swaps content.
// Two series per size: install only (`demolish: []`) and with a demolish list, which the pump
// counts in `pending`.
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
  // The budget is main-thread JS: skip deck's draw (SwiftShader takes ~250 ms a frame at 30,000
  // projects, even off screen), as timeline.perf does. Layers, the pump and MapLibre run as usual.
  overlayOf(map).setProps({ layerFilter: () => false });
  return h;
}

/** One log line per stage, with the time since the test began. */
const T_START = { at: 0 };
const stage = (msg: string) =>
  console.info(`[apply-cost] +${((performance.now() - T_START.at) / 1000).toFixed(1)}s ${msg}`);

/** Wall-clock bound of one wait. */
const WAIT_MS = 60_000;

/** Polls `read` each frame until `ok` holds; throws a clear message after WAIT_MS. */
async function waitFor<T>(what: string, read: () => T, ok: (v: T) => boolean): Promise<void> {
  const t0 = performance.now();
  for (;;) {
    const v = read();
    if (ok(v)) return;
    if (performance.now() - t0 > WAIT_MS)
      throw new Error(
        `timed out after ${WAIT_MS / 1000} s waiting for ${what}; last snapshot ${JSON.stringify(v)}`
      );
    await nextFrame();
  }
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

/** Applies `u` and returns the ms until its revision is in and `pending === 0`. */
async function applyTimed(h: SimMapHandle, u: TimelineUpdate): Promise<number> {
  const t0 = performance.now();
  h.applyTimeline(u);
  await waitFor(
    `revision ${u.revision} installed and pending 0`,
    () => dbg().timelineSnapshot(),
    (s) => s !== null && s.revision === u.revision && s.pending === 0
  );
  return performance.now() - t0;
}

describe('apply cost (real map, playback running)', { timeout: 900_000 }, () => {
  it('times one fill update of 22 and of 121 cells until pending is 0', async () => {
    T_START.at = performance.now();
    const h = await mountReady();
    stage('map ready');
    h.setTime(SYNTHETIC_START);
    h.setTimelineLookups(SYNTHETIC_LOOKUPS);
    const stop = startPlayback(h);
    const out: string[] = [];
    try {
      for (const k of KS) {
        const g0 = performance.now();
        const a = makeSyntheticTimeline(1, k * PER_CELL, PER_CELL);
        const b = makeSyntheticTimeline(2, k * PER_CELL, PER_CELL);
        stage(
          `k=${k}: generated 2 updates (${k * PER_CELL} projects each) in ${(performance.now() - g0).toFixed(0)} ms`
        );
        expect(a.cells.length).toBe(k);
        // The base: K cells of seed 1 as a revision 0 snapshot, settled before timing.
        h.applyTimeline({ ...a, demolish: [] });
        const b0 = performance.now();
        await waitFor(
          `${k} base cells installed and pending 0`,
          () => dbg().timelineSnapshot(),
          (sn) => sn !== null && sn.cells === k && sn.pending === 0
        );
        stage(`k=${k}: base installed in ${(performance.now() - b0).toFixed(0)} ms`);
        // Two series: install only (no demolish list), then with the generator's demolish list
        // (fresh parcel ids each run, so the pump always has new entries). The synthetic parcels
        // are not on the fixture map, so the pump's feature-state calls hit no feature.
        for (const withDemolish of [false, true]) {
          const ms: number[] = [];
          for (let r = 0; r < RUNS; r++) {
            const next = r % 2 === 0 ? b : a;
            const revision = dbg().timelineSnapshot()!.revision + 1;
            const demolish = withDemolish
              ? next.demolish.map((d) => ({ ...d, parcelId: `${d.parcelId}-${k}-${revision}` }))
              : [];
            ms.push(await applyTimed(h, { ...next, revision, demolish }));
          }
          // Pending reached 0 for every timed apply (applyTimed throws otherwise).
          expect(dbg().timelineSnapshot()!.pending).toBe(0);
          const tag = withDemolish ? 'with_demolish' : 'install_only';
          stage(
            `k=${k} ${withDemolish ? 'with demolish' : 'install only'}: samples [${ms.map((x) => x.toFixed(0))}] ms`
          );
          out.push(
            `k${k}_${tag}_median_ms=${median(ms).toFixed(1)} ` +
              `k${k}_${tag}_samples_ms=[${ms.map((x) => x.toFixed(1))}]`
          );
        }
      }
    } finally {
      stop();
    }
    console.info(`[apply-cost] perCell=${PER_CELL} runs=${RUNS} ${out.join(' ')}`);
  });
});
