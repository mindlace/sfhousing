import { describe, expect, it } from 'vitest';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import {
  BLOCK,
  EMPTY,
  NearestField,
  closeGapLines,
  frameFor,
  insideDistance,
  lineCount,
  rasterizeRings,
  vertexToLngLat,
  type GapDir,
  type RasterFrame
} from './raster';

const CELL = 2;
// 200 m x 100 m frame whose SW corner is the projection origin, no pad
const bbox: [number, number, number, number] = [
  LNG0,
  LAT0,
  LNG0 + 200 / M_PER_DEG_LNG,
  LAT0 + 100 / M_PER_DEG_LAT
];
const f: RasterFrame = frameFor(bbox, CELL, 0);

/** Rectangle in frame metres (x east, y north from the SW corner) as a lng/lat ring. */
function rect(x: number, y: number, w: number, h: number): [number, number][][] {
  const p = (px: number, py: number): [number, number] => [
    LNG0 + (f.x0 + px) / M_PER_DEG_LNG,
    LAT0 + (f.y0 + py) / M_PER_DEG_LAT
  ];
  return [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]];
}
const cellAt = (fr: RasterFrame, xM: number, yM: number) =>
  Math.floor(yM / fr.cell) * fr.cols + Math.floor(xM / fr.cell);
const count = (l: Uint32Array, v: number) => l.reduce((n, x) => n + (x === v ? 1 : 0), 0);
const sameComp = (a: number, b: number) => (a === b ? a : EMPTY);
const rank = (l: number) => l;
function close(l: Uint32Array, maxGap = 30, filled = new Uint8Array(l.length)) {
  for (let d = 0 as GapDir; d < 4; d++)
    closeGapLines(l, f, d, 0, lineCount(f, d), maxGap, sameComp, rank, filled);
}
const blank = () => new Uint32Array(f.cols * f.rows);
function layout(gapW: number, bLabel = 1) {
  const l = blank();
  rasterizeRings(f, rect(10, 10, 60, 80), 1, l);
  rasterizeRings(f, rect(70 + gapW, 10, 60, 80), bLabel, l);
  return l;
}

describe('frame and rasterize', () => {
  it('frame origin is SW and vertices map back to lng/lat', () => {
    expect(f.cols).toBe(100);
    expect(f.rows).toBe(50);
    const [lng, lat] = vertexToLngLat(f, 10, 20);
    expect(lng).toBeCloseTo(LNG0 + 20 / M_PER_DEG_LNG, 9);
    expect(lat).toBeCloseTo(LAT0 + 40 / M_PER_DEG_LAT, 9);
  });
  it('even-odd: a hole is left empty', () => {
    const l = blank();
    const n = rasterizeRings(f, [rect(10, 10, 40, 40)[0], rect(20, 20, 10, 10)[0]], 5, l);
    expect(n).toBe(20 * 20 - 5 * 5);
    expect(l[cellAt(f, 25, 25)]).toBe(EMPTY);
    expect(l[cellAt(f, 12, 12)]).toBe(5);
  });
});

describe('closeGapLines', () => {
  it('a 25 ft x 100 ft lot survives between two same-limit blocks', () => {
    const l = blank();
    rasterizeRings(f, rect(10, 10, 40, 80), 1, l);
    rasterizeRings(f, rect(50, 10, 7.62, 30.48), 2, l);
    rasterizeRings(f, rect(57.62, 10, 40, 80), 1, l);
    const before = count(l, 2);
    close(l);
    expect(count(l, 2)).toBeGreaterThanOrEqual(3 * 15);
    expect(count(l, 2)).toBe(before);
  });
  it('closes a 20 m street between two blocks of one component, not a 40 m one', () => {
    const l20 = layout(20);
    close(l20);
    expect(l20[cellAt(f, 80, 50)]).toBe(1);
    const l40 = layout(40);
    close(l40, 30);
    expect(l40[cellAt(f, 90, 50)]).toBe(EMPTY);
  });
  it('never bridges across BLOCK or off the raster edge', () => {
    const l = layout(20);
    rasterizeRings(f, rect(72, 10, 16, 80), BLOCK, l);
    close(l);
    expect(l[cellAt(f, 80, 50)]).toBe(BLOCK);
    const e = blank();
    rasterizeRings(f, rect(10, 10, 60, 80), 1, e);
    close(e);
    expect(e[cellAt(f, 80, 50)]).toBe(EMPTY);
    expect(e[cellAt(f, 198, 50)]).toBe(EMPTY);
  });
  it('does not bridge two different components', () => {
    const l = layout(20, 2);
    close(l);
    expect(l[cellAt(f, 80, 50)]).toBe(EMPTY);
  });
  it('reusing a labels array with a fresh mask cannot overwrite a real lot cell', () => {
    const l = blank();
    for (const [x, y] of [
      [10, 40],
      [90, 40]
    ])
      rasterizeRings(f, rect(x, y, 60, 20), 1, l);
    rasterizeRings(f, rect(70, 10, 20, 30), 3, l);
    rasterizeRings(f, rect(70, 60, 20, 30), 3, l);
    close(l);
    expect(l[cellAt(f, 80, 50)]).toBe(3);
    // rebuild in the same array: a 1-labelled lot now sits where the bridge cell was filled
    l.fill(0);
    rasterizeRings(f, rect(10, 40, 60, 20), 1, l);
    rasterizeRings(f, rect(90, 40, 60, 20), 1, l);
    rasterizeRings(f, rect(70, 40, 20, 20), 1, l);
    rasterizeRings(f, rect(70, 10, 20, 30), 3, l);
    rasterizeRings(f, rect(70, 60, 20, 30), 3, l);
    close(l);
    expect(l[cellAt(f, 80, 50)]).toBe(1);
  });
  it('closes an intersection; the higher rank wins a contested cell', () => {
    const l = blank();
    for (const [x, y] of [
      [10, 10],
      [90, 10],
      [10, 60],
      [90, 60]
    ])
      rasterizeRings(f, rect(x, y, 60, 30), 1, l);
    close(l);
    expect(l[cellAt(f, 80, 50)]).toBe(1);
    // west/east blocks label 1, south/north blocks label 3, each pair bridges with its own label
    const c = blank();
    rasterizeRings(f, rect(10, 40, 60, 20), 1, c);
    rasterizeRings(f, rect(90, 40, 60, 20), 1, c);
    rasterizeRings(f, rect(70, 10, 20, 30), 3, c);
    rasterizeRings(f, rect(70, 60, 20, 30), 3, c);
    close(c);
    expect(c[cellAt(f, 80, 50)]).toBe(3);
  });
});

describe('NearestField', () => {
  it('takes the nearest seed within reach, -1 beyond', () => {
    const f15: RasterFrame = frameFor(bbox, 15, 0);
    const seeds = Float64Array.of(LNG0 + 10 / M_PER_DEG_LNG, LAT0 + 5 / M_PER_DEG_LAT);
    const nf = new NearestField(f15, seeds, Float32Array.of(30));
    nf.forward(0, f15.rows);
    nf.backward(0, f15.rows);
    expect(nf.result()[cellAt(f15, 10, 0)]).toBe(0);
    expect(nf.result()[cellAt(f15, 25, 0)]).toBe(0);
    expect(nf.result()[cellAt(f15, 195, 0)]).toBe(-1);
  });
});

describe('insideDistance', () => {
  it('the centre of a 20 m square is about 10 m from its edge', () => {
    const g = blank();
    rasterizeRings(f, rect(40, 30, 20, 20), 1, g);
    const out = new Float32Array(g.length);
    insideDistance(g, f, 0, f.rows, out, 'forward');
    insideDistance(g, f, 0, f.rows, out, 'backward');
    const d = out[cellAt(f, 50, 40)];
    expect(d).toBeGreaterThan(8.5);
    expect(d).toBeLessThan(11.5);
  });
});
