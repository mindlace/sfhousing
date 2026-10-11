import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
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
import { TYPOLOGY_ORDER, type GeneratedUpdate, type PackedCell } from './types';
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
    // Drain: rev 2's rise runs to completion; rev 1's rise never resurfaces as a stray merge.
    const histAt = f.layerHistory.length;
    for (let t = 116; f.pendingFrames() > 0 && t < 5000; t += 16) f.flushFrame(t);
    expect(f.pendingFrames()).toBe(0);
    expect(layerIds(f)).toEqual(['generated-A', 'generated-B']);
    expect((layerById(f, 'generated-A')!.props.data as { length: number }).length).toBe(
      packOf('A', 0, 6).partCount
    );
    // Exactly one rebuild of generated-A during the drain: rev 2's merge.
    const rebuilds = f.layerHistory
      .slice(histAt)
      .map((ls) => ls.find((l) => l.id === 'generated-A'))
      .filter((l, i, a) => i === 0 || l !== a[i - 1]);
    expect(rebuilds.length).toBe(2);
    expect(c.debugSnapshot().parts).toBe(
      packOf('A', 0, 6).partCount + packOf('B', 6, 12).partCount
    );
  });

  it('mid-rise removal: removedCells drops a rising cell with no later merge', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    f.time = 0;
    c.apply(riseA(1));
    f.flushFrame(100);
    c.apply(upd(2, { removedCells: ['A'] }));
    expect(layerIds(f)).toEqual(['generated-B']);
    for (let t = 116; f.pendingFrames() > 0 && t < 5000; t += 16) f.flushFrame(t);
    expect(f.pendingFrames()).toBe(0);
    expect(layerIds(f)).toEqual(['generated-B']);
    expect(c.debugSnapshot().cells).toBe(1);
  });

  it('reduced motion is checked live per update', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    f.reduced = true;
    c.apply(riseA(1));
    expect(layerIds(f).some((id) => id.startsWith('rising-'))).toBe(false);
    f.reduced = false;
    c.apply(riseA(2));
    expect(layerIds(f)).toContain('rising-2-A');
    f.reduced = true;
    c.apply(riseA(3)); // finalises rising-2-A, then installs rev 3 without a rise
    expect(layerIds(f).some((id) => id.startsWith('rising-'))).toBe(false);
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

  /** Every drawn cell's replacing parcels are hidden, and no undrawn cell's parcels are. */
  function checkCoLocated(f: FakeDeps, cellOf: Map<string, string>) {
    const drawn = new Set(layerIds(f).map((id) => id.replace(/^(generated|rising-\d+)-/, '')));
    for (const [id, cellId] of cellOf) expect(f.replaced.has(id)).toBe(drawn.has(cellId));
  }

  it('F1: a whole-city erase restores each building in the slice its cell disappears', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    const snap = makeSyntheticCity(11, 15_000, 1500)[0];
    expect(snap.cells).toHaveLength(10);
    const cellOf = new Map<string, string>();
    for (const x of snap.cells)
      for (const id of x.settled.parcelIds) cellOf.set(id, x.settled.cellId);
    c.apply(snap);
    for (let t = 16; f.pendingFrames() > 0; t += 16) f.flushFrame(t);
    checkCoLocated(f, cellOf);
    c.apply(
      upd(1, {
        removedCells: snap.cells.map((x) => x.settled.cellId),
        hide: { add: [], remove: [...snap.hide.add] }
      })
    );
    let frames = 0;
    checkCoLocated(f, cellOf);
    for (let t = 1000; f.pendingFrames() > 0; t += 16, frames++) {
      f.flushFrame(t);
      checkCoLocated(f, cellOf);
    }
    expect(frames).toBeGreaterThanOrEqual(4); // 10 cells, 2 per slice (3000 ids ≥ SLICE_IDS)
    expect(layerIds(f)).toEqual([]);
    expect(f.replaced.size).toBe(0);
    expect(c.hidden.size).toBe(0);
  });

  it('F1: a typology repaint (no hide ids) installs at most 4 cells per frame', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    const snap = makeSyntheticCity(12, 15_000, 1500)[0];
    c.apply(snap);
    for (let t = 16; f.pendingFrames() > 0; t += 16) f.flushFrame(t);
    const before = new Map(f.lastLayers.map((l) => [l.id, l]));
    const repaint = makeSyntheticCity(12, 15_000, 1500)[0];
    c.apply({ ...repaint, revision: 1, hide: { add: [], remove: [] } });
    const changed = () => f.lastLayers.filter((l) => before.get(l.id) !== l).length;
    const counts = [changed()];
    for (let t = 1000; f.pendingFrames() > 0; t += 16) {
      f.flushFrame(t);
      counts.push(changed());
    }
    expect(counts).toEqual([4, 8, 10]);
    expect(f.replaced.size).toBe(15_000);
  });

  it('F1: an erase queued behind its own unapplied install still restores with the cell', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(upd(0));
    const big = asIncremental(makeSyntheticCity(13, 15_000, 1500)[0], 1);
    const cellOf = new Map<string, string>();
    for (const x of big.cells)
      for (const id of x.rising!.parcelIds) cellOf.set(id, x.rising!.cellId);
    c.apply(big);
    // rev 2 arrives before rev 1 has drained: membership comes from rev 1, not the drawn cells.
    c.apply(
      upd(2, {
        removedCells: big.cells.map((x) => x.rising!.cellId),
        hide: { add: [], remove: [...big.hide.add] }
      })
    );
    checkCoLocated(f, cellOf);
    for (let t = 16; f.pendingFrames() > 0 && t < 10_000; t += 16) {
      f.flushFrame(t);
      checkCoLocated(f, cellOf);
    }
    expect(layerIds(f)).toEqual([]);
    expect(f.replaced.size).toBe(0);
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

  it('lookup resolves a part on a rising layer, including typology', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    const u = riseA(1);
    c.apply(u);
    const r = u.cells[0].rising!;
    for (let k = 0; k < r.partCount; k++) {
      const slot = r.partSlot[k];
      const hit = c.lookup('rising-1-A', k)!;
      expect(hit.parcelId).toBe(r.parcelIds[slot]);
      expect(hit.typology).toBe(TYPOLOGY_ORDER[r.parcelMeta[4 * slot + 3]]);
      const b = gen.find((g) => g.parcelId === hit.parcelId)!;
      expect(hit.typology).toBe(b.typology);
    }
    expect(c.lookup('rising-1-B', 0)).toBeNull();
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

// Same as SimMap's setupLibraries: Vite pre-bundles maplibre-gl away from its sibling worker,
// so MapLibre's default worker URL 404s ("Worker failed to load"). Point it at the asset URL.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

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
