import { describe, expect, it } from 'vitest';
import { FTF_M, GROUND_FTF_M } from '$lib/generator/constants';
import { CONSTRAINTS } from '$lib/map/camera';
import {
  FOG_BOUNDS,
  FOG_CELL_M,
  buildFogGrid,
  fogInstances,
  sampleFog,
  storiesToM,
  type FogGrid
} from './grid';

const empty: FogGrid = buildFogGrid(new Float64Array(0), new Uint8Array(0));

/** The centre of cell (c, r). */
const at = (c: number, r: number): [number, number] => [
  empty.west + (c + 0.5) * empty.dLng,
  empty.south + (r + 0.5) * empty.dLat
];

/** One row per cell where `f` gives stories. */
function field(f: (c: number, r: number) => number | null): FogGrid {
  const lp: number[] = [];
  const st: number[] = [];
  for (let r = 0; r < empty.rows; r++)
    for (let c = 0; c < empty.cols; c++) {
      const s = f(c, r);
      if (s === null) continue;
      lp.push(...at(c, r));
      st.push(s);
    }
  return buildFogGrid(new Float64Array(lp), new Uint8Array(st));
}

describe('fog grid', () => {
  it("FOG_BOUNDS is the map's max bounds", () => {
    expect(FOG_BOUNDS).toEqual(CONSTRAINTS.maxBounds);
  });

  it('covers FOG_BOUNDS with ~50 m cells', () => {
    expect(empty.west).toBe(FOG_BOUNDS[0][0]);
    expect(empty.south).toBe(FOG_BOUNDS[0][1]);
    expect(empty.west + empty.cols * empty.dLng).toBeGreaterThanOrEqual(FOG_BOUNDS[1][0]);
    expect(empty.south + empty.rows * empty.dLat).toBeGreaterThanOrEqual(FOG_BOUNDS[1][1]);
    expect(empty.heightM.length).toBe((empty.cols + 1) * (empty.rows + 1));
    expect(FOG_CELL_M).toBe(50);
    expect(empty.heightM.every((h) => h === 0)).toBe(true);
  });

  it("stories to metres uses the generator's floor heights", () => {
    expect(storiesToM(0)).toBe(0);
    expect(storiesToM(1)).toBe(GROUND_FTF_M);
    expect(storiesToM(4)).toBeCloseTo(GROUND_FTF_M + 3 * FTF_M, 6);
  });

  it('a uniform field is flat at its height, inside the city', () => {
    const g = field((c, r) => (c >= 10 && c < 30 && r >= 10 && r < 30 ? 4 : null));
    for (let r = 13; r <= 27; r++)
      for (let c = 13; c <= 27; c++)
        expect(g.heightM[r * (g.cols + 1) + c]).toBeCloseTo(storiesToM(4), 4);
  });

  it('two plateaus meet in a monotone ramp, flat three cells from the seam', () => {
    const g = field((c, r) => (r >= 10 && r < 30 && c >= 10 && c < 40 ? (c < 25 ? 4 : 12) : null));
    const row = 20;
    const h = (c: number) => g.heightM[row * (g.cols + 1) + c];
    for (let c = 12; c < 38; c++) expect(h(c + 1)).toBeGreaterThanOrEqual(h(c) - 1e-4);
    expect(h(21)).toBeCloseTo(storiesToM(4), 4);
    expect(h(29)).toBeCloseTo(storiesToM(12), 4);
  });

  it('roads between blocks are covered; far water is not', () => {
    // two blocks one empty cell apart, and an empty area 10 cells away
    const g = field((c, r) => (r >= 10 && r < 20 && (c === 10 || c === 12) ? 6 : null));
    expect(sampleFog(g, ...at(11, 15))).toBeGreaterThan(0);
    expect(sampleFog(g, ...at(25, 15))).toBe(0);
  });

  it('the tallest limit in a cell wins; rows with no envelope (0) are empty', () => {
    const lp = new Float64Array([...at(20, 20), ...at(20, 20), ...at(5, 5)]);
    const g = buildFogGrid(lp, new Uint8Array([4, 20, 0]));
    expect(sampleFog(g, ...at(20, 20))).toBeGreaterThan(storiesToM(4));
    expect(sampleFog(g, ...at(5, 5))).toBe(0);
  });

  it('samples 0 outside the grid', () => {
    const g = field(() => 6);
    expect(sampleFog(g, FOG_BOUNDS[0][0] - 0.01, FOG_BOUNDS[0][1] + 0.01)).toBe(0);
    expect(sampleFog(g, ...at(3, 3))).toBeCloseTo(storiesToM(6), 4);
  });

  it('fogInstances keeps only cells with height and their four corners', () => {
    const g = field((c, r) => (c === 20 && r === 20 ? 8 : null));
    const fi = fogInstances(g);
    expect(fi.count).toBeGreaterThan(0);
    expect(fi.corners.length).toBe(4 * fi.count);
    expect(fi.anchors.length).toBe(2 * fi.count);
    for (let k = 0; k < fi.count; k++)
      expect(Math.max(...fi.corners.subarray(4 * k, 4 * k + 4))).toBeGreaterThan(0);
    // the occupied cell is among them, anchored at its south-west corner
    const [lng, lat] = at(20, 20);
    let found = false;
    for (let k = 0; k < fi.count; k++)
      if (
        Math.abs(fi.anchors[2 * k] - (lng - g.dLng / 2)) < 1e-9 &&
        Math.abs(fi.anchors[2 * k + 1] - (lat - g.dLat / 2)) < 1e-9
      )
        found = true;
    expect(found).toBe(true);
  });
});
