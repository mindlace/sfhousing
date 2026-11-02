import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { generateDetailed } from '$lib/generator/generate';
import { compositionParcel } from '$lib/generator/fixtures/composition-parcel';
import { drawVariety } from '$lib/generator/variety';
import { drawComposition } from '$lib/generator/composition-variety';
import type { GeneratedBuilding } from '$lib/generator';
import type { ParcelRecord } from '$lib/data/parcel';
import { GeneratedController, RISE_MS, easeOutCubic } from './generated-controller';
import { emptyPack, packCell } from './pack';
import { appearanceColor } from './appearance';
import { TYPOLOGY_ORDER, type GeneratedUpdate, type PackedCell } from './types';
import { makeFakeDeps, type FakeDeps } from './test/fake-deps';
import { makeSyntheticCity } from './test/synthetic-city';
import { BG_STYLE, harness, idle, nextFrame, type Harness } from './test/real-deck';
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
const beforeIdOf = (l: Layer) => (l.props as { beforeId?: string }).beforeId;

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

  it('labelBeforeId: generated, rising and overlay layers all draw before the label layer', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light', 'x');
    c.apply(snapshot0());
    f.time = 1000;
    c.apply(riseA(1));
    const ring = new ScatterplotLayer({ id: 'brush-ring', data: [] });
    const swath = new PathLayer({ id: 'brush-swath', data: [] });
    c.setOverlayLayers([ring, swath]);
    expect(layerIds(f)).toEqual([
      'generated-A',
      'generated-B',
      'rising-1-A',
      'brush-ring',
      'brush-swath'
    ]);
    for (const l of f.lastLayers) expect(beforeIdOf(l)).toBe('x');
    // The caller's overlay instances are not mutated: they are cloned with the beforeId.
    expect(beforeIdOf(ring)).toBeUndefined();
    const settled = f.lastLayers.slice(0, 2);
    f.flushFrame(1000 + RISE_MS / 2);
    expect(beforeIdOf(layerById(f, 'rising-1-A')!)).toBe('x');
    expect(f.lastLayers.slice(0, 2)[0]).toBe(settled[0]);
    expect(f.lastLayers.slice(0, 2)[1]).toBe(settled[1]);
    c.setTheme('dark');
    for (const l of f.lastLayers) expect(beforeIdOf(l)).toBe('x');
  });

  it('labelBeforeId unset: layers carry no beforeId and overlay instances pass through', () => {
    const f = makeFakeDeps();
    const c = new GeneratedController(f, 'light');
    c.apply(snapshot0());
    const ring = new ScatterplotLayer({ id: 'brush-ring', data: [] });
    c.setOverlayLayers([ring]);
    for (const l of f.lastLayers) expect(beforeIdOf(l)).toBeFalsy();
    expect(f.lastLayers.at(-1)).toBe(ring);
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

// Real deck harness (src/lib/map/test/real-deck.ts): C3 here, C5 in generated-controller.perf.svelte.spec.ts.

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
    expect(a.firstColor).toEqual(
      appearanceColor('light', TYPOLOGY_ORDER[p.partTypology[0]], p.partAppearance[0])
    );
  });

  it('C3b: deck draws a side wall on every edge of every packed ring', async () => {
    h = await harness(BG_STYLE);
    const c = h.controller();
    const p = packOf('A', 0, 12);
    c.apply(upd(0, { cells: [{ settled: p, rising: null }] }));
    await idle(h.map);
    await nextFrame();
    type Tess = {
      vertexStarts: ArrayLike<number>;
      get(name: 'positions' | 'vertexValid'): ArrayLike<number>;
    };
    const lm = (h.overlay as unknown as { _deck: { layerManager: { getLayers(): Layer[] } } })._deck
      .layerManager;
    const live = lm.getLayers().find((l) => l.id === 'generated-A') as unknown as {
      state: { polygonTesselator: Tess };
    };
    const tess = live.state.polygonTesselator;
    const pos = tess.get('positions');
    const valid = tess.get('vertexValid');
    // The side model draws one quad from vertex i to vertex i + 1 wherever vertexValid[i] is set.
    const key = (x: number, y: number) => `${Math.fround(x)},${Math.fround(y)}`;
    let missing = 0;
    for (let k = 0; k < p.partCount; k++) {
      const drawn = new Set<string>();
      for (let i = tess.vertexStarts[k]; i < tess.vertexStarts[k + 1] - 1; i++)
        if (valid[i])
          drawn.add(`${key(pos[3 * i], pos[3 * i + 1])}>${key(pos[3 * i + 3], pos[3 * i + 4])}`);
      // Expected walls: every edge of the footprint, closing edge included.
      const ring: string[] = [];
      for (let v = p.startIndices[k]; v < p.startIndices[k + 1]; v++)
        ring.push(key(p.positions[2 * v], p.positions[2 * v + 1]));
      if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
      for (let i = 0; i < ring.length; i++)
        if (!drawn.has(`${ring[i]}>${ring[(i + 1) % ring.length]}`)) missing++;
    }
    expect(p.partCount).toBeGreaterThan(0);
    expect({ parts: p.partCount, missing }).toEqual({ parts: p.partCount, missing: 0 });
  });
});

for (const theme of ['light', 'dark'] as const)
  it(`${theme}: sibling towers and caps rise together and pick one parcel total`, () => {
    const building = generateDetailed(
      compositionParcel('paired', 60, 50),
      { maxStories: 40 },
      drawVariety(1),
      'max',
      { ...drawComposition(1), familyOrder: ['paired'], capEnabled: true }
    )!.building;
    const pack = packCell('a', [{ building, existingUnits: 0 }]);
    const f = makeFakeDeps(),
      c = new GeneratedController(f, theme);
    c.apply(upd(0));
    c.apply(upd(1, { cells: [{ settled: emptyPack('a'), rising: pack }] }));
    f.flushFrame(RISE_MS / 2);
    expect(c.debugSnapshot().elevationScale['rising-1-a']).toBeCloseTo(easeOutCubic(0.5));
    expect(layerIds(f)).toEqual(['rising-1-a']);
    for (let i = 0; i < pack.partCount; i++) {
      expect(c.lookup('rising-1-a', i)!.parcelId).toBe('paired');
      expect(c.lookup('rising-1-a', i)!.units).toBe(building.units);
    }
    for (let t = RISE_MS; t < 1000 && f.pendingFrames(); t += 16) f.flushFrame(t);
    expect(layerIds(f)).toEqual(['generated-a']);
    expect(c.debugSnapshot().parts).toBe(pack.partCount);
    c.destroy();
  });
