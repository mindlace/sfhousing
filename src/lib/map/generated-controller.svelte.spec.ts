import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import type { GeneratedBuilding } from '$lib/generator';
import type { ParcelRecord } from '$lib/data/parcel';
import {
  GeneratedController,
  RISE_MS,
  easeOutCubic,
  type ControllerDeps
} from './generated-controller';
import { emptyPack, packCell } from './pack';
import { GEN_RGBA } from './palette';
import type { GeneratedUpdate, PackedCell } from './types';
import { makeFakeDeps, type FakeDeps } from './test/fake-deps';
import { makeSyntheticCity } from './test/synthetic-city';
import genJson from './fixtures/generated-small.json';
import parcelsJson from './fixtures/parcels-small.json';

const gen = genJson as unknown as GeneratedBuilding[];
const parcels = parcelsJson as unknown as ParcelRecord[];

function packOf(cellId: string, from: number, to: number): PackedCell {
  return packCell(
    cellId,
    gen
      .slice(from, to)
      .map((b, i) => ({ building: b, existingUnits: parcels[from + i].existingUnits }))
  );
}
const ids = (p: PackedCell) => p.parcelIds;
const layerIds = (f: FakeDeps) => f.lastLayers.map((l) => l.id);
const layerById = (f: FakeDeps, id: string) => f.lastLayers.find((l) => l.id === id);

function upd(revision: number, partial: Partial<GeneratedUpdate> = {}): GeneratedUpdate {
  return { revision, cells: [], removedCells: [], hide: { add: [], remove: [] }, ...partial };
}

/** Rev 0: cell A holds fixtures 0-5 settled; cell B holds 6-11 settled. */
function snapshot0(): GeneratedUpdate {
  const a = packOf('A', 0, 6),
    b = packOf('B', 6, 12);
  return upd(0, {
    cells: [
      { settled: a, rising: null },
      { settled: b, rising: null }
    ],
    hide: { add: [...ids(a), ...ids(b)], remove: [] }
  });
}

/** Rev n: cell A = fixtures 0-2 settled + 3-5 rising. */
function riseA(revision: number): GeneratedUpdate {
  const s = packOf('A', 0, 3),
    r = packOf('A', 3, 6);
  return upd(revision, { cells: [{ settled: s, rising: r }] });
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

describe('GeneratedController (fake deps)', () => {
  it('C4: reduced motion merges rising straight into settled', () => {
    const f = makeFakeDeps();
    f.reduced = true;
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    const u = riseA(1);
    c.apply(u);
    expect(layerIds(f).some((id) => id.startsWith('rising-'))).toBe(false);
    const layer = layerById(f, 'generated-A')!;
    const parts = u.cells[0].settled.partCount + u.cells[0].rising!.partCount;
    expect((layer.props.data as { length: number }).length).toBe(parts);
    expect(c.debugSnapshot().elevationScale['generated-A']).toBe(1);
    expect(f.pendingFrames()).toBe(0);
  });

  it('rise: animates elevationScale with ease-out cubic, then merges one frame later', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    f.time = 1000;
    c.apply(riseA(1));
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B', 'rising-1-A']);
    expect(c.debugSnapshot().elevationScale['rising-1-A']).toBe(0);
    const settledBefore = layerById(f, 'generated-A');
    f.flushFrame(1000 + RISE_MS / 2);
    expect(c.debugSnapshot().elevationScale['rising-1-A']).toBeCloseTo(easeOutCubic(0.5), 6);
    // settled layer props are referentially stable between frames
    expect(layerById(f, 'generated-A')).toBe(settledBefore);
    f.flushFrame(1000 + RISE_MS);
    expect(c.debugSnapshot().elevationScale['rising-1-A']).toBe(1);
    f.flushFrame(1000 + RISE_MS + 16);
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B']);
    expect((layerById(f, 'generated-A')!.props.data as { length: number }).length).toBe(
      packOf('A', 0, 6).partCount
    );
    expect(f.pendingFrames()).toBe(0);
  });

  it('mid-rise touch: finalises the pending rise before applying the next revision', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    f.time = 0;
    c.apply(riseA(1));
    f.flushFrame(100);
    const s2 = packOf('A', 0, 4);
    c.apply(upd(2, { cells: [{ settled: s2, rising: packOf('A', 4, 6) }] }));
    const idsNow = layerIds(f);
    expect(idsNow).not.toContain('rising-1-A');
    expect(idsNow).toContain('rising-2-A');
    expect((layerById(f, 'generated-A')!.props.data as { length: number }).length).toBe(
      s2.partCount
    );
    expect(c.debugSnapshot().elevationScale['rising-2-A']).toBe(0);
  });

  it('C6: a revision gap resyncs; revision 0 replaces everything', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    const before = f.layerHistory.length;
    c.apply(riseA(2));
    expect(f.resyncCount).toBe(1);
    expect(f.layerHistory.length).toBe(before);
    c.apply(riseA(1)); // starts a rise
    const p = packOf('C', 0, 2);
    c.apply(
      upd(0, {
        cells: [{ settled: p, rising: packOf('C', 2, 3) }],
        hide: { add: ids(p), remove: [] }
      })
    );
    expect(f.clearAllCount).toBe(2);
    expect(layerIds(f)).toEqual(['generated-C']);
    expect([...c.hidden].sort()).toEqual([...ids(p)].sort());
    expect([...f.replaced].sort()).toEqual([...ids(p)].sort());
    expect(c.debugSnapshot().revision).toBe(0);

    const g = makeFakeDeps();
    new GeneratedController(g, 'light').apply(riseA(5));
    expect(g.resyncCount).toBe(1);
    expect(g.layerHistory).toHaveLength(0);
  });

  it('snapshot mid-slice and mid-rise drops pending slices', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(upd(0));
    const big = asIncremental(makeSyntheticCity(3, 5000, 1000)[0], 1);
    c.apply(big);
    expect(f.pendingFrames()).toBe(1);
    const snap = snapshot0();
    c.apply(snap);
    for (let t = 16; t < 2000; t += 16) f.flushFrame(t);
    expect([...c.hidden].sort()).toEqual([...snap.hide.add].sort());
    expect([...f.replaced].sort()).toEqual([...snap.hide.add].sort());
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B']);
  });

  it('slicing: slice 0 sync, then one per frame; never hides before the layer exists', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(upd(0));
    const big = asIncremental(makeSyntheticCity(4, 5000, 1000)[0], 1);
    expect(big.cells).toHaveLength(5);
    const cellOf = new Map<string, string>();
    for (const x of big.cells)
      for (const id of x.rising!.parcelIds) cellOf.set(id, x.rising!.cellId);
    const check = () => {
      const present = new Set(layerIds(f).map((id) => id.replace(/^(generated|rising-\d+)-/, '')));
      for (const id of f.replaced) expect(present.has(cellOf.get(id) ?? '?')).toBe(true);
    };
    f.events.length = 0;
    c.apply(big);
    expect(f.replaced.size).toBe(2000);
    expect(f.events.filter((e) => e[0] === 'setLayers')).toHaveLength(1);
    check();
    // rev 2 arrives mid-drain: it must queue behind rev 1's slices
    const r2 = riseA(2);
    r2.hide.add = ids(r2.cells[0].settled);
    c.apply(r2);
    expect(f.replaced.size).toBe(2000);
    expect(layerIds(f)).not.toContain('rising-2-A');
    f.flushFrame(16);
    expect(f.replaced.size).toBe(4000);
    check();
    f.flushFrame(32);
    expect(f.replaced.size).toBe(5000);
    expect(layerIds(f)).not.toContain('rising-2-A');
    check();
    f.flushFrame(48);
    expect(f.replaced.size).toBe(5000 + r2.hide.add.length);
    expect(layerIds(f)).toContain('rising-2-A');
    const setOrder = f.events.filter((e) => e[0] === 'setReplaced').map((e) => e[1]);
    expect(setOrder.slice(-r2.hide.add.length)).toEqual(r2.hide.add);
  });

  it('removal: removedCells and hide.remove apply in one synchronous setLayers', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    const snap = snapshot0();
    c.apply(snap);
    const before = f.layerHistory.length;
    const removeIds = ids(snap.cells[1].settled);
    c.apply(upd(1, { removedCells: ['B'], hide: { add: [], remove: removeIds } }));
    expect(f.layerHistory.length).toBe(before + 1);
    expect(layerIds(f)).toEqual(['generated-A']);
    for (const id of removeIds) {
      expect(f.replaced.has(id)).toBe(false);
      expect(c.hidden.has(id)).toBe(false);
    }
    expect(f.pendingFrames()).toBe(0);
    expect(c.debugSnapshot().cells).toBe(1);
  });

  it('C7: overlay layers render last, are replaceable and leave generated layers untouched', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    const gens = f.lastLayers.slice();
    const ring = new ScatterplotLayer({ id: 'brush-ring', data: [] });
    const swath = new PathLayer({ id: 'brush-swath', data: [] });
    c.setOverlayLayers([ring, swath]);
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B', 'brush-ring', 'brush-swath']);
    expect(f.lastLayers.slice(0, 2)).toEqual(gens);
    expect(f.lastLayers[0]).toBe(gens[0]);
    expect(f.lastLayers[1]).toBe(gens[1]);
    const ring2 = new ScatterplotLayer({ id: 'brush-ring', data: [] });
    c.setOverlayLayers([ring2]);
    expect(f.lastLayers.at(-1)).toBe(ring2);
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B', 'brush-ring']);
    c.setOverlayLayers([]);
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B']);
    expect(f.lastLayers[0]).toBe(gens[0]);
    expect(() =>
      c.setOverlayLayers([new ScatterplotLayer({ id: 'generated-x', data: [] })])
    ).toThrow();
    expect(() =>
      c.setOverlayLayers([new ScatterplotLayer({ id: 'rising-x', data: [] })])
    ).toThrow();
  });

  it('theme: setTheme bumps the fill colour trigger and leaves the mirror alone', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    const hiddenBefore = [...c.hidden];
    const before = layerById(f, 'generated-A')!;
    c.setTheme('dark');
    const gens = f.lastLayers.filter((l) => l.id.startsWith('generated-'));
    expect(gens).toHaveLength(2);
    for (const l of gens) expect(l.props.updateTriggers.getFillColor).toBe('dark');
    const after = layerById(f, 'generated-A')!;
    expect(after).not.toBe(before);
    expect(after.props.data).toBe(before.props.data);
    expect([...c.hidden]).toEqual(hiddenBefore);
  });

  it('lookup resolves a part through the pack', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    const snap = snapshot0();
    c.apply(snap);
    const p = snap.cells[0].settled;
    const slot = p.partSlot[0];
    const hit = c.lookup('generated-A', 0)!;
    expect(hit.parcelId).toBe(p.parcelIds[slot]);
    expect(hit.units).toBe(p.parcelMeta[4 * slot]);
    expect(hit.existingUnits).toBe(p.parcelMeta[4 * slot + 1]);
    expect(hit.stories).toBe(p.parcelMeta[4 * slot + 2]);
    expect(c.lookup('generated-Z', 0)).toBeNull();
    expect(c.lookup('generated-A', 9999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Real deck harness: MapLibre map + interleaved MapLibreOverlay (C3, C5).

interface HarnessOpts {
  reducedMotion?: () => boolean;
  /**
   * false: generated/rising layers reach deck with `visible: false`. deck still matches them,
   * tessellates and fills attributes (all main-thread work), but SwiftShader does not rasterise
   * them. Used only by the whole-city budget: headless software GL stalls the main thread for
   * seconds per frame on 150k extruded buildings, which spec §4.12 says CI cannot measure.
   */
  drawGenerated?: boolean;
}

interface Harness {
  map: maplibregl.Map;
  overlay: MapLibreOverlay;
  deps: ControllerDeps;
  controller(theme?: 'light' | 'dark'): GeneratedController;
  done(): void;
}

const BG_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }]
};

/** Same background style plus a `buildings` vector source that never requests tiles at z12. */
const BUILDINGS_STYLE: maplibregl.StyleSpecification = {
  ...BG_STYLE,
  sources: {
    buildings: {
      type: 'vector',
      tiles: ['http://127.0.0.1:9/{z}/{x}/{y}.pbf'],
      minzoom: 20,
      maxzoom: 20,
      promoteId: { buildings: 'parcelId' }
    }
  }
};

async function harness(
  style: maplibregl.StyleSpecification,
  opts: HarnessOpts = {}
): Promise<Harness> {
  const {
    reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    drawGenerated = true
  } = opts;
  const container = document.createElement('div');
  container.style.cssText = 'width:400px;height:300px';
  document.body.appendChild(container);
  const map = new maplibregl.Map({
    container,
    style,
    center: [-122.44, 37.76],
    zoom: 12,
    attributionControl: false
  });
  await new Promise<void>((r) => map.once('load', () => r()));
  const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay);
  const fs = { source: 'buildings', sourceLayer: 'buildings' };
  const hiddenClones = new WeakMap<Layer, Layer>();
  const forDeck = (l: Layer) => {
    if (drawGenerated || !/^(generated|rising)-/.test(l.id)) return l;
    let x = hiddenClones.get(l);
    if (!x) hiddenClones.set(l, (x = l.clone({ visible: false })));
    return x;
  };
  const controllers: GeneratedController[] = [];
  const deps: ControllerDeps = {
    setLayers: (layers) => overlay.setProps({ layers: layers.map(forDeck) }),
    setReplaced: (id) => map.setFeatureState({ ...fs, id }, { replaced: true }),
    clearReplaced: (id) => map.removeFeatureState({ ...fs, id }, 'replaced'),
    clearAllReplaced: () => {
      if (map.getSource('buildings')) map.removeFeatureState(fs);
    },
    SolidPolygonLayer,
    raf: (cb) => requestAnimationFrame(cb),
    cancelRaf: (n) => cancelAnimationFrame(n),
    now: () => performance.now(),
    reducedMotion,
    onResyncNeeded: () => {}
  };
  return {
    map,
    overlay,
    deps,
    controller(theme = 'light') {
      const c = new GeneratedController(deps, theme);
      controllers.push(c);
      return c;
    },
    done() {
      for (const c of controllers) c.destroy();
      overlay.finalize();
      map.remove();
      container.remove();
    }
  };
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const idle = (map: maplibregl.Map) =>
  new Promise<void>((r) => {
    map.once('idle', () => r());
    map.triggerRepaint();
  });

/** One rising cell of `n` synthetic parcels as revision `rev`. */
function syntheticRise(seed: number, n: number, rev: number): GeneratedUpdate {
  return asIncremental(makeSyntheticCity(seed, n, n)[0], rev);
}

describe('GeneratedController (real deck)', () => {
  let h: Harness | null = null;
  afterEach(() => {
    h?.done();
    h = null;
  });

  it('C3: per-object accessors expand per vertex', async () => {
    h = await harness(BG_STYLE);
    const c = h.controller();
    const p = packOf('A', 0, 12);
    c.apply(upd(0, { cells: [{ settled: p, rising: null }] }));
    await idle(h.map);
    await nextFrame();
    const a = c.debugSnapshot().attributes['generated-A'];
    expect(a).toBeDefined();
    expect(a.vertexCount).toBeGreaterThanOrEqual(p.positions.length / 2);
    expect(a.firstColor).toEqual(GEN_RGBA.light[p.partTypology[0]]);
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

  it('C5: whole-city feed has no long task > 50 ms and every slice ≤ 8 ms', async () => {
    const updates = makeSyntheticCity(1, 150_000, 1500);
    h = await harness(BUILDINGS_STYLE, { reducedMotion: () => false, drawGenerated: false });
    const c = h.controller();
    const longTasks: PerformanceEntry[] = [];
    const obs = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
    obs.observe({ type: 'longtask', buffered: true });
    performance.clearMeasures('sfh-slice');
    await nextFrame();
    const t0 = performance.now();
    for (const u of updates) {
      c.apply(u);
      await nextFrame();
    }
    for (let i = 0; i < 5000 && c.debugSnapshot().pending > 0; i++) await nextFrame();
    await nextFrame();
    await nextFrame();
    obs.disconnect();
    const snap = c.debugSnapshot();
    expect(snap.pending).toBe(0);
    expect(snap.hidden).toBe(150_000);
    expect(snap.cells).toBe(100);
    expect(snap.layerIds.filter((id) => id.startsWith('rising-'))).toEqual([]);
    const durations = performance.getEntriesByName('sfh-slice', 'measure').map((e) => e.duration);
    const tasks = longTasks.filter((e) => e.startTime >= t0).map((e) => e.duration);
    const sorted = [...durations].sort((a, b) => a - b);
    console.info(
      `[C5] wall ${(performance.now() - t0).toFixed(0)} ms; slices n=${durations.length} ` +
        `p50=${sorted[sorted.length >> 1].toFixed(2)} max=${sorted.at(-1)!.toFixed(2)} ms; ` +
        `long tasks ${JSON.stringify(tasks.map(Math.round))}`
    );
    expect(durations.length).toBeGreaterThan(0);
    expect(tasks.filter((d) => d > 50)).toEqual([]);
    for (const d of durations) expect(d).toBeLessThanOrEqual(8);
  }, 120_000);
});
