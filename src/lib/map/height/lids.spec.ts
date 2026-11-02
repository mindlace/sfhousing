import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { SRC_FZP, SRC_PAINT, SRC_RULE0 } from '$lib/sim/levers/source';
import { BLOCK, EMPTY } from './raster';
import {
  LID_CELL_M,
  LID_MAX_SPAN_M,
  LID_PAD_M,
  LidTooLarge,
  createLidBuild,
  type LidInput
} from './lids';
import { lidLabelText, storiesToM } from './room';
import { CHAIN_LIMIT, CHAIN_SOURCE, type HeightLids } from './types';
import {
  LOT_D,
  LOT_W,
  blockByWaterAndPark,
  exceptionInBlock,
  lotBlock,
  paintedSameHeight,
  runLids,
  scene,
  stepAcrossStreet,
  tinyLimits,
  tinyLimitsScene,
  toLngLat,
  twoBlocks,
  type Scene
} from './test/fixtures';

const run = (sc: Scene | LidInput): HeightLids => runLids('input' in sc ? sc.input : sc);

function pieceOf(l: HeightLids, q: { stories: number; source?: number }): number {
  const hits: number[] = [];
  for (let p = 0; p < l.pieces.stories.length; p++)
    if (
      l.pieces.stories[p] === q.stories &&
      (q.source === undefined || l.pieces.source[p] === q.source)
    )
      hits.push(p);
  expect(hits).toHaveLength(1);
  return hits[0];
}

function rimCount(l: HeightLids): number {
  return l.rims.starts.length - 1;
}

function rimsOf(l: HeightLids, q: { piece?: number; kind?: number; ownerSource?: number }) {
  const out: number[] = [];
  for (let k = 0; k < rimCount(l); k++) {
    const p = l.rims.piece[k];
    if (q.piece !== undefined && p !== q.piece) continue;
    if (q.kind !== undefined && l.rims.kind[k] !== q.kind) continue;
    if (q.ownerSource !== undefined && l.pieces.source[p] !== q.ownerSource) continue;
    out.push(k);
  }
  return out;
}

function rimHeights(l: HeightLids, piece?: number): Set<number> {
  const out = new Set<number>();
  for (const k of rimsOf(l, { piece }))
    for (let v = l.rims.starts[k]; v < l.rims.starts[k + 1]; v++)
      out.add(l.rims.positions[3 * v + 2]);
  return out;
}

function wallsOwnedBy(l: HeightLids, p: number): number[] {
  const out: number[] = [];
  for (let w = 0; w < l.walls.count; w++) if (l.walls.piece[w] === p) out.push(w);
  return out;
}

/** Walls are Float32: expected heights go through Math.fround. */
const f32 = (zs: number[]) => zs.map(Math.fround);

function wallSpan(l: HeightLids, p: number): [number, number] {
  const ws = wallsOwnedBy(l, p);
  return [Math.min(...ws.map((w) => l.walls.zLo[w])), Math.max(...ws.map((w) => l.walls.zHi[w]))];
}

/** Ring area in m² (shoelace on lng/lat scaled to metres); positive for CCW. */
function ringAreaM2(r: Float64Array): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return (a / 2) * M_PER_DEG_LNG * M_PER_DEG_LAT;
}

function faceAreaM2(l: HeightLids, piece?: number): number {
  let a = 0;
  for (const f of l.faces) {
    if (piece !== undefined && f.piece !== piece) continue;
    a += ringAreaM2(f.rings[0]);
    for (const h of f.rings.slice(1)) a += ringAreaM2(h);
  }
  return a;
}

function inRing(r: Float64Array, x: number, y: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i];
    const yi = r[2 * i + 1];
    const xj = r[2 * j];
    const yj = r[2 * j + 1];
    if (yi > y !== yj > y && x < xj + ((y - yj) / (yi - yj)) * (xi - xj)) inside = !inside;
  }
  return inside;
}

function facesContaining(l: HeightLids, [x, y]: [number, number]): number {
  return l.faces.filter(
    (f) => inRing(f.rings[0], x, y) && !f.rings.slice(1).some((h) => inRing(h, x, y))
  ).length;
}

/** Lid cells (not EMPTY, not BLOCK) of a finished build's raster. */
function lidCells(input: LidInput): number {
  const b = createLidBuild(input);
  while (!b.step(Infinity, () => performance.now()));
  let n = 0;
  for (const v of b.raster().labels) if (v !== EMPTY && v !== BLOCK) n++;
  return n;
}

describe('createLidBuild', () => {
  it('a 25 ft exception is its own piece: a face, rims at its height, walls to its 4-story neighbours', () => {
    const l = run(exceptionInBlock(4, 6));
    const p = pieceOf(l, { stories: 6 });
    expect(l.faces.filter((f) => f.piece === p)).toHaveLength(1);
    expect(rimHeights(l, p)).toEqual(new Set([storiesToM(6)]));
    expect(wallsOwnedBy(l, p).length).toBeGreaterThan(0);
    expect(wallSpan(l, p)).toEqual(f32([storiesToM(4), storiesToM(6)]));
    // walls are only between the exception and its neighbours: none owned by the 4-story piece
    expect(wallsOwnedBy(l, pieceOf(l, { stories: 4 }))).toHaveLength(0);
  });

  it('R13: a lower 25 ft lot survives rasterize, close, trace, simplify(1.2 m) and faces with its own rim', () => {
    const lots = lotBlock(0, 0, 12, 2, (i, j) => ({ stories: i === 6 && j === 1 ? 3 : 5 }));
    const l = run(scene(lots));
    const p = pieceOf(l, { stories: 3 });
    expect(l.faces.filter((f) => f.piece === p)).toHaveLength(1);
    const lotArea = LOT_W * LOT_D;
    expect(Math.abs(faceAreaM2(l, p) - lotArea) / lotArea).toBeLessThan(0.2);
    expect(rimsOf(l, { piece: p, kind: CHAIN_LIMIT }).length).toBeGreaterThan(0);
    // its face contains its centre, and the 5-story face does not
    const centre = toLngLat(6.5 * LOT_W, 1.5 * LOT_D);
    expect(facesContaining(l, centre)).toBe(1);
    expect(l.faces.find((f) => f.piece === p && inRing(f.rings[0], ...centre))).toBeDefined();
    // the 5-story lid walls down to it from all sides but the street
    expect(wallSpan(l, pieceOf(l, { stories: 5 }))).toEqual(f32([storiesToM(3), storiesToM(5)]));
  });

  it('a lid spans a 20 m street between two blocks of one component; not a 40 m one', () => {
    const near = twoBlocks(20);
    const far = twoBlocks(40);
    expect(facesContaining(run(near), near.streetCentre)).toBe(1);
    expect(facesContaining(run(far), far.streetCentre)).toBe(0);
  });

  it('no wall to the water or to a limit-0 lot: only the rim', () => {
    const l = run(blockByWaterAndPark(4));
    expect(l.walls.count).toBe(0);
    expect(rimsOf(l, { kind: CHAIN_LIMIT }).length).toBeGreaterThan(0);
    expect(l.pieces.stories.length).toBe(1);
  });

  it('4 and 8 blocks across a street: no wall (not adjacent), rims at both heights', () => {
    const l = run(stepAcrossStreet(4, 8));
    expect(l.walls.count).toBe(0);
    expect(rimHeights(l)).toEqual(new Set([storiesToM(4), storiesToM(8)]));
  });

  it('a painted lot at its neighbours’ height is a separate piece with a CHAIN_SOURCE rim', () => {
    const l = run(paintedSameHeight(4));
    expect([...l.pieces.source]).toContain(SRC_PAINT);
    expect(rimsOf(l, { kind: CHAIN_SOURCE, ownerSource: SRC_PAINT }).length).toBeGreaterThan(0);
    expect(rimsOf(l, { kind: CHAIN_SOURCE, ownerSource: SRC_FZP }).length).toBeGreaterThan(0);
    expect(l.walls.count).toBe(0);
    expect(new Set(l.pieces.component).size).toBe(1);
  });

  it('faces tile the lid cells: Σ face area ≈ lid cells × 4 m² (±1%)', () => {
    const sc = tinyLimitsScene();
    const l = run(sc);
    const cells = lidCells(sc.input);
    expect(cells).toBeGreaterThan(0);
    const want = cells * LID_CELL_M * LID_CELL_M;
    expect(Math.abs(faceAreaM2(l) - want) / want).toBeLessThan(0.01);
  });

  it('one label per component, with the component’s room', () => {
    const sc = twoBlocks(20);
    const l = run(sc);
    const compA = sc.model.lotComponent[0];
    expect(sc.model.lotComponent[sc.lots.length - 1]).toBe(compA);
    expect(l.labels.text.filter((t) => t.startsWith('4 stories'))).toHaveLength(1);
    expect(l.labels.text).toContain(lidLabelText(4, sc.model.componentRoom[compA]));
    expect(sc.model.componentRoom[compA]).toBe(2 * sc.lots.length);
    // the label sits on the lid at its height
    expect(l.labels.position[2]).toBe(storiesToM(4));
  });

  it('tinyLimits: a label per region, pieces carry their component’s glaze', () => {
    const sc = tinyLimitsScene();
    const l = run(sc);
    expect(l.labels.text.filter((t) => t.startsWith('4 stories'))).toHaveLength(1);
    expect(l.labels.text.some((t) => t.startsWith('8 stories'))).toBe(true);
    for (let p = 0; p < l.pieces.stories.length; p++) {
      const c = l.pieces.component[p];
      expect(l.pieces.glaze[p]).toBe(sc.model.componentGlaze[c]);
      expect(l.pieces.stories[p]).toBe(sc.model.componentStories[c]);
    }
    // the 8-story block is wall-adjacent to the 4s
    const p8 = pieceOf(l, { stories: 8 });
    expect(wallSpan(l, p8)).toEqual(f32([storiesToM(4), storiesToM(8)]));
    expect(tinyLimits().lids.faces.length).toBe(l.faces.length);
  });

  it('R4: paint mode labels the painted piece and the rest of its component, each with its own room', () => {
    const sc = paintedSameHeight(4);
    const l = run(sc);
    const comp = sc.model.lotComponent[0];
    const total = sc.model.componentRoom[comp];
    const painted = sc.model.lotRoom[sc.painted];
    expect(painted).toBe(3);
    expect(total).toBe(3 * sc.lots.length);
    expect(l.labels.text).toEqual([lidLabelText(4, total)]);
    expect([...l.paintLabels.text].sort()).toEqual(
      [lidLabelText(4, painted), lidLabelText(4, total - painted)].sort()
    );
    // a lid without paint has the same labels in both modes
    const plain = run(twoBlocks(20));
    expect(plain.paintLabels).toEqual(plain.labels);
  });

  it('a bbox over 3 km + pads throws LidTooLarge; limitsRev and sourceIds are echoed', () => {
    const sc = scene(
      lotBlock(0, 0, 4, 2, () => ({ src: SRC_RULE0, stories: 6 })),
      {
        limitsRev: 41,
        sourceIds: ['r1']
      }
    );
    const span = (m: number): LidInput['bbox'] => {
      const [w, s] = toLngLat(0, 0);
      const [e, n] = toLngLat(m, 100);
      return [w, s, e, n];
    };
    expect(() => createLidBuild({ ...sc.input, bbox: span(3500) })).toThrow(LidTooLarge);
    expect(() =>
      createLidBuild({ ...sc.input, bbox: span(LID_MAX_SPAN_M + 2 * LID_PAD_M - 1) })
    ).not.toThrow();
    const l = run(sc);
    expect(l.limitsRev).toBe(41);
    expect(l.sourceIds).toEqual(['r1']);
    expect([...l.pieces.source]).toEqual([SRC_RULE0]);
  });

  it('step(budget) returns false until done, result throws before, and matches a single run', () => {
    const sc = tinyLimitsScene();
    const b = createLidBuild(sc.input);
    expect(() => b.result()).toThrow();
    let n = 0;
    while (!b.step(0, () => 0)) n++;
    expect(n).toBeGreaterThan(5);
    const once = run(sc);
    expect(b.result().faces.map((f) => [f.piece, ...f.rings.map((r) => [...r])])).toEqual(
      once.faces.map((f) => [f.piece, ...f.rings.map((r) => [...r])])
    );
    expect([...b.result().rims.positions]).toEqual([...once.rims.positions]);
  });
});
