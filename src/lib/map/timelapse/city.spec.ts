import { describe, expect, it } from 'vitest';
import { CITY_GRID, cityGroup, citySquare } from './city-grid';
import { CityStore } from './city';
import { MARK_AREA_M } from './constants';
import { CITY_DAY, SLOT_FLAG, type CityDelta } from '../types';
import { CONSTRAINTS } from '../camera';

const C: [number, number] = [-122.42, 37.77];
/** Metres per degree of latitude. */
const M_LAT = 111_195;
const M_LNG = M_LAT * Math.cos((37.765 * Math.PI) / 180);
/** `c` moved `e` m east and `n` m north. */
const off = (c: [number, number], e: number, n = 0): [number, number] => [
  c[0] + e / M_LNG,
  c[1] + n / M_LAT
];

interface M {
  row: number;
  at: [number, number];
  days: [number, number, number];
  homes?: number;
  flags?: number;
}
/** A delta of markers `ms` (ascending rows) with `rows` rows. */
function delta(rows: number, ms: M[], from?: number): CityDelta {
  const k = ms.length;
  const d: CityDelta = {
    rows,
    row: Int32Array.from(ms.map((m) => m.row)),
    lngLat: new Float32Array(2 * k),
    days: new Float32Array(3 * k),
    homes: Uint16Array.from(ms.map((m) => m.homes ?? 10)),
    flags: Uint8Array.from(ms.map((m) => m.flags ?? 0))
  };
  ms.forEach((m, i) => {
    d.lngLat.set(m.at, 2 * i);
    d.days.set(m.days, 3 * i);
  });
  if (from !== undefined) d.from = from;
  return d;
}
const store = (rows: number, ms: M[]) => {
  const s = new CityStore();
  s.apply(delta(rows, ms), true);
  return s;
};

const F = 21000; // from
const N = NaN;

describe('the grid', () => {
  it('cityGroup puts points 800 m apart in different squares and clamps points outside the bounds', () => {
    const g = cityGroup(...C);
    expect(cityGroup(...off(C, MARK_AREA_M))).not.toBe(g);
    expect(cityGroup(...off(C, 0, MARK_AREA_M))).not.toBe(g);
    expect(cityGroup(...off(C, -MARK_AREA_M))).not.toBe(g);
    // A square is MARK_AREA_M on each side.
    const [w, s, e, n] = citySquare(g);
    expect((e - w) * M_LNG).toBeCloseTo(MARK_AREA_M, -1);
    expect((n - s) * M_LAT).toBeCloseTo(MARK_AREA_M, -1);
    expect(C[0]).toBeGreaterThanOrEqual(w);
    expect(C[0]).toBeLessThan(e);
    expect(C[1]).toBeGreaterThanOrEqual(s);
    expect(C[1]).toBeLessThan(n);
    // Outside the bounds: the edge squares.
    const [[W, S], [E, Nn]] = CONSTRAINTS.maxBounds;
    expect(cityGroup(W - 1, S - 1)).toBe(0);
    expect(cityGroup(E + 1, Nn + 1)).toBe(CITY_GRID.cols * CITY_GRID.rows - 1);
    expect(cityGroup(E + 1, S - 1)).toBe(CITY_GRID.cols - 1);
  });
});

describe('CityStore', () => {
  it('CityStore: replace takes the delta whole; apply writes its rows and drops markers at or past rows', () => {
    const s = store(6, [
      { row: 1, at: C, days: [F + 1, N, N], flags: SLOT_FLAG.money },
      { row: 4, at: C, days: [F + 2, N, N] },
      { row: 5, at: C, days: [F + 3, N, N] }
    ]);
    expect([s.size, s.flagged]).toEqual([3, 1]);
    // A later delta: overwrite row 1 (no flag now), add row 2, drop rows >= 5.
    s.apply(
      delta(5, [
        { row: 1, at: C, days: [F + 7, N, N] },
        { row: 2, at: C, days: [N, F + 8, N], flags: SLOT_FLAG.zoning }
      ]),
      false
    );
    expect([s.size, s.flagged]).toEqual([3, 1]);
    expect(Array.from(s.has.subarray(0, 6))).toEqual([0, 1, 1, 0, 1, 0]);
    expect(s.days[3 * 2 + CITY_DAY.started]).toBe(F + 8);
    expect(s.days[3 * 1 + CITY_DAY.approved]).toBe(F + 7);
    expect(s.has[5]).toBe(0);
    // Replace: only the delta's markers remain.
    s.apply(delta(9, [{ row: 8, at: C, days: [F + 9, N, N] }]), true);
    expect([s.size, s.flagged]).toEqual([1, 0]);
    expect(s.days[3 * 8]).toBe(F + 9);
    expect(s.has[1]).toBe(0);
    s.clear();
    expect([s.size, s.flagged]).toEqual([0, 0]);
    expect(s.has.every((h) => h === 0)).toBe(true);
  });

  it('CityStore.apply forgets markers at or past from before writing the rows, rows past from included', () => {
    const s = store(6, [
      { row: 1, at: C, days: [F + 1, N, N] },
      { row: 3, at: C, days: [F + 2, N, N], flags: SLOT_FLAG.zoning },
      { row: 4, at: C, days: [F + 3, N, N] },
      { row: 5, at: C, days: [F + 4, N, N] }
    ]);
    // A rewind to 3, refilled to 6 before the flush: row 4 re-created, 3 and 5 not.
    s.apply(delta(6, [{ row: 4, at: C, days: [F + 40, N, N] }], 3), false);
    expect([s.size, s.flagged]).toEqual([2, 0]);
    expect(Array.from(s.has.subarray(0, 6))).toEqual([0, 1, 0, 0, 1, 0]);
    // None of the forgotten rows' days survive.
    expect(s.days[3 * 4]).toBe(F + 40);
  });

  it('CityStore.apply rejects a malformed delta and leaves the store as it was', () => {
    const s = store(3, [{ row: 1, at: C, days: [F + 1, N, N] }]);
    const bad = delta(3, [{ row: 2, at: C, days: [F + 5, N, N] }], 0);
    bad.days = new Float32Array(2);
    expect(() => s.apply(bad, false)).toThrow(RangeError);
    expect(() => s.apply(delta(2, [{ row: 2, at: C, days: [F, N, N] }]), true)).toThrow(RangeError);
    expect([s.size, s.flagged]).toEqual([1, 0]);
    expect(s.days[3 * 1]).toBe(F + 1);
  });
});
