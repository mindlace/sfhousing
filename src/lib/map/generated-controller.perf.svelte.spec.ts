// C5 main-thread frame budgets for GeneratedController on a real deck. Wall-clock: these run in
// `npm run test:perf` (project client-perf) on an idle machine, not in test:unit or signoff.
import { afterEach, describe, expect, it } from 'vitest';
import { emptyPack } from './pack';
import type { GeneratedUpdate } from './types';
import { makeSyntheticCity } from './test/synthetic-city';
import { BUILDINGS_STYLE, harness, idle, nextFrame, type Harness } from './test/real-deck';

function upd(revision: number, partial: Partial<GeneratedUpdate> = {}): GeneratedUpdate {
  return { revision, cells: [], removedCells: [], hide: { add: [], remove: [] }, ...partial };
}

/** Turn every cell of a synthetic snapshot into a rising cell of an incremental update. */
function asIncremental(u: GeneratedUpdate, revision: number): GeneratedUpdate {
  return {
    revision,
    cells: u.cells.map((c) => ({ settled: emptyPack(c.settled.cellId), rising: c.settled })),
    removedCells: [],
    hide: { add: [...u.hide.add], remove: [] }
  };
}

/** One rising cell of `n` synthetic parcels as revision `rev`. */
function syntheticRise(seed: number, n: number, rev: number): GeneratedUpdate {
  return asIncremental(makeSyntheticCity(seed, n, n)[0], rev);
}

describe('GeneratedController (real deck) C5 budgets', () => {
  let h: Harness | null = null;
  afterEach(() => {
    h?.done();
    h = null;
  });

  it('C5: a 500-parcel update reaches its first rising frame within 30 ms', async () => {
    h = await harness(BUILDINGS_STYLE, { reducedMotion: () => false });
    const c = h.controller();
    c.apply(upd(0));
    // Warm-up: the first SolidPolygonLayer in a fresh GL context compiles its shaders once.
    c.apply(syntheticRise(6, 50, 1));
    while (c.debugSnapshot().pending > 0) await nextFrame();
    await idle(h.map);
    const u = syntheticRise(7, 500, 2);
    performance.mark('sfh-apply-start');
    c.apply(u);
    const applyMs =
      performance.now() - performance.getEntriesByName('sfh-apply-start')[0].startTime;
    expect(c.debugSnapshot().layerIds).toContain(`rising-2-${u.cells[0].rising!.cellId}`);
    await nextFrame();
    performance.mark('sfh-apply-frame');
    const m = performance.measure('sfh-apply', 'sfh-apply-start', 'sfh-apply-frame');
    console.info(
      `[C5] apply() ${applyMs.toFixed(1)} ms; to first rising frame ${m.duration.toFixed(1)} ms`
    );
    expect(m.duration).toBeLessThanOrEqual(30);
  });

  it('C5: whole-city feed has no long task or frame gap > 50 ms and every slice ≤ 8 ms', async () => {
    const updates = makeSyntheticCity(1, 150_000, 1500);
    h = await harness(BUILDINGS_STYLE, { reducedMotion: () => false, drawGenerated: false });
    const c = h.controller();
    const longTasks: PerformanceEntry[] = [];
    const obs = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
    obs.observe({ type: 'longtask', buffered: true });
    // The longtask observer does not see rAF work inside the Vitest iframe, and slices, merges
    // and deck's deferred tessellation all run in rAF. Gaps between successive rAF timestamps
    // do see it (layers are visible:false, so rasterisation is not in the gap).
    h.deps.setLayers([]);
    await idle(h.map); // deck's layerManager exists once the overlay has rendered
    const deckUpdates: { start: number; dur: number }[] = [];
    const lmProto = Object.getPrototypeOf(
      (h.overlay as unknown as { _deck: { layerManager: object } })._deck.layerManager
    ) as { updateLayers: (...a: unknown[]) => unknown };
    const origUpdate = lmProto.updateLayers;
    lmProto.updateLayers = function (this: unknown, ...a: unknown[]) {
      const start = performance.now();
      const r = origUpdate.apply(this, a);
      deckUpdates.push({ start, dur: performance.now() - start });
      return r;
    };
    const gaps: number[] = [];
    let last = await nextFrame();
    const frame = async () => {
      const t = await nextFrame();
      gaps.push(t - last);
      last = t;
    };
    performance.clearMeasures('sfh-slice');
    const t0 = performance.now();
    try {
      for (const u of updates) {
        c.apply(u);
        await frame();
      }
      for (let i = 0; i < 5000 && c.debugSnapshot().pending > 0; i++) await frame();
      await frame();
      await frame();
    } finally {
      lmProto.updateLayers = origUpdate;
      obs.disconnect();
    }
    const snap = c.debugSnapshot();
    expect(snap.pending).toBe(0);
    expect(snap.hidden).toBe(150_000);
    expect(snap.cells).toBe(100);
    expect(snap.layerIds.filter((id) => id.startsWith('rising-'))).toEqual([]);
    const slices = performance.getEntriesByName('sfh-slice', 'measure');
    const durations = slices.map((e) => e.duration);
    // Slice plus the first deck update after it (deck tessellates on its next render).
    const withDeck = slices.map((e) => {
      const next = deckUpdates.find((d) => d.start >= e.startTime + e.duration);
      return e.duration + (next?.dur ?? 0);
    });
    const tasks = longTasks.filter((e) => e.startTime >= t0).map((e) => e.duration);
    const max = (xs: number[]) => Math.max(...xs);
    const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    console.info(
      `[C5] wall ${(performance.now() - t0).toFixed(0)} ms; frames=${gaps.length}; ` +
        `gap p50=${p50(gaps).toFixed(1)} max=${max(gaps).toFixed(1)} ms; ` +
        `slices n=${durations.length} p50=${p50(durations).toFixed(2)} max=${max(durations).toFixed(2)} ms; ` +
        `slice+deck p50=${p50(withDeck).toFixed(2)} max=${max(withDeck).toFixed(2)} ms; ` +
        `deck updates max=${max(deckUpdates.map((d) => d.dur)).toFixed(2)} ms; ` +
        `long tasks ${JSON.stringify(tasks.map(Math.round))}`
    );
    expect(durations.length).toBeGreaterThan(0);
    expect(tasks.filter((d) => d > 50)).toEqual([]);
    for (const d of durations) expect(d).toBeLessThanOrEqual(8);
    expect(max(gaps)).toBeLessThanOrEqual(50);
  }, 120_000);
  it('C5: a whole-city repaint and erase, each ONE revision, keep gaps ≤ 50 ms and slices ≤ 8 ms', async () => {
    const all = (seed: number) =>
      makeSyntheticCity(seed, 150_000, 1500).flatMap((u) =>
        u.cells.map((x) => ({ settled: x.rising ?? x.settled, rising: null }))
      );
    const city = all(1);
    const repaint = all(1); // same parcels, fresh buffers: deck re-tessellates every cell
    const allIds = city.flatMap((x) => x.settled.parcelIds);
    h = await harness(BUILDINGS_STYLE, { reducedMotion: () => false, drawGenerated: false });
    const c = h.controller();
    c.apply(upd(0, { cells: city, hide: { add: allIds, remove: [] } }));
    while (c.debugSnapshot().pending > 0) await nextFrame();
    await idle(h.map);
    expect(c.debugSnapshot().cells).toBe(100);

    const deckUpdates: number[] = [];
    const lmProto = Object.getPrototypeOf(
      (h.overlay as unknown as { _deck: { layerManager: object } })._deck.layerManager
    ) as { updateLayers: (...a: unknown[]) => unknown };
    const origUpdate = lmProto.updateLayers;
    lmProto.updateLayers = function (this: unknown, ...a: unknown[]) {
      const start = performance.now();
      const r = origUpdate.apply(this, a);
      deckUpdates.push(performance.now() - start);
      return r;
    };
    const gaps: number[] = [];
    const run = async (u: GeneratedUpdate) => {
      let last = await nextFrame();
      c.apply(u);
      for (let i = 0; i < 2000 && c.debugSnapshot().pending > 0; i++) {
        const t = await nextFrame();
        gaps.push(t - last);
        last = t;
      }
      const t = await nextFrame(); // deck's deferred tessellation of the last slice
      gaps.push(t - last);
    };
    performance.clearMeasures('sfh-slice');
    let repaintSlices: number, repaintDeck: number;
    try {
      await run(upd(1, { cells: repaint }));
      repaintSlices = performance.getEntriesByName('sfh-slice', 'measure').length;
      repaintDeck = Math.max(...deckUpdates);
      expect(c.debugSnapshot().hidden).toBe(150_000);
      await run(
        upd(2, {
          removedCells: city.map((x) => x.settled.cellId),
          hide: { add: [], remove: allIds }
        })
      );
    } finally {
      lmProto.updateLayers = origUpdate;
    }
    const snap = c.debugSnapshot();
    expect(snap.pending).toBe(0);
    expect(snap.cells).toBe(0);
    expect(snap.hidden).toBe(0);
    expect(snap.layerIds).toEqual([]);
    const durations = performance.getEntriesByName('sfh-slice', 'measure').map((e) => e.duration);
    const max = (xs: number[]) => Math.max(...xs);
    console.info(
      `[C5 F1] slices repaint=${repaintSlices} erase=${durations.length - repaintSlices}; ` +
        `slice max=${max(durations).toFixed(2)} ms; deck update max repaint=${repaintDeck.toFixed(1)} ` +
        `all=${max(deckUpdates).toFixed(1)} ms; gap max=${max(gaps).toFixed(1)} ms`
    );
    expect(repaintSlices).toBe(25);
    expect(durations.length - repaintSlices).toBe(50);
    for (const d of durations) expect(d).toBeLessThanOrEqual(8);
    expect(max(gaps)).toBeLessThanOrEqual(50);
  }, 120_000);
});
