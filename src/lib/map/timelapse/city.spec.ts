import { describe, expect, it } from 'vitest';
import {
  CITY_GRID,
  CITY_KIND,
  CITY_KIND_TOKEN,
  CityStore,
  blockOutside,
  buildCity,
  cityBlock,
  cityEdgePx,
  cityGroup,
  cityRadiusPx,
  citySquare,
  edgeOf,
  evalCity,
  type CityAttrs,
  type Clip
} from './city';
import { HALO_TOKEN } from './halos';
import {
  CITY_BUCKET_DAYS,
  CITY_CELL_M,
  CITY_EDGE_DAYS,
  CITY_HANDOVER_ZOOM,
  CITY_R_MAX_PX,
  CITY_RING_DAYS,
  HALO_R_PX
} from './constants';
import { CITY_DAY, SLOT_FLAG, type CityDelta } from '../types';
import { CONSTRAINTS } from '../camera';
import { cityGrid, gridSite, mulberry32 } from '../test/synthetic-city';
import { SYNTHETIC_END, SYNTHETIC_START } from '../test/synthetic-timeline';

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

/** A record of `kind` at C with day `day` and `homes`. */
function rec(day: number, kind: 0 | 1 | 2 | 3 = 1, homes = 10, anchor = C): CityAttrs {
  const sq = citySquare(cityGroup(anchor[0], anchor[1]));
  return { anchor, day, homes, kind, square: sq };
}

const IN: Clip = [0, 0, 1];
const RIGHT: Clip = [2, 0.5, 1];
/** Margin-block corners wholly beyond the right edge, and ones straddling it. */
const BLOCK_OUT: Clip[] = [
  [1.5, -1, 1],
  [3, -1, 1],
  [1.5, 1, 1],
  [3, 1, 1]
];
const BLOCK_STRADDLE: Clip[] = [
  [0.5, -1, 1],
  [3, -1, 1],
  [0.5, 1, 1],
  [3, 1, 1]
];

describe('the grid', () => {
  it('cityGroup puts points 800 m apart in different squares and clamps points outside the bounds', () => {
    const g = cityGroup(...C);
    expect(cityGroup(...off(C, CITY_CELL_M))).not.toBe(g);
    expect(cityGroup(...off(C, 0, CITY_CELL_M))).not.toBe(g);
    expect(cityGroup(...off(C, -CITY_CELL_M))).not.toBe(g);
    // A square is CITY_CELL_M on each side.
    const [w, s, e, n] = citySquare(g);
    expect((e - w) * M_LNG).toBeCloseTo(CITY_CELL_M, -1);
    expect((n - s) * M_LAT).toBeCloseTo(CITY_CELL_M, -1);
    expect(C[0]).toBeGreaterThanOrEqual(w);
    expect(C[0]).toBeLessThan(e);
    expect(C[1]).toBeGreaterThanOrEqual(s);
    expect(C[1]).toBeLessThan(n);
    // Outside the bounds: the edge squares.
    const [[W, S], [E, Nn]] = CONSTRAINTS.maxBounds;
    expect(cityGroup(W - 1, S - 1)).toBe(0);
    expect(cityGroup(E + 1, Nn + 1)).toBe(CITY_GRID.cols * CITY_GRID.rows - 1);
    expect(cityGroup(E + 1, S - 1)).toBe(CITY_GRID.cols - 1);
    // The margin block is the square widened by one square on each side.
    const b = cityBlock([w, s, e, n]);
    expect(b).toEqual([2 * w - e, 2 * s - n, 2 * e - w, 2 * n - s]);
  });
});

describe('buildCity', () => {
  it('buildCity: one record per square, half-year and kind after from, at the homes-weighted centre, day = its latest event, homes = the sum', () => {
    const a = off(C, 100);
    const b = off(C, 300, 100);
    const s = store(5, [
      { row: 0, at: a, days: [F + 10, N, N], homes: 10 },
      { row: 3, at: b, days: [F + 100, N, N], homes: 30 },
      // The next half-year: its own record.
      { row: 4, at: a, days: [F + CITY_BUCKET_DAYS, N, N], homes: 5 }
    ]);
    const r = buildCity(s, F);
    expect(r).toHaveLength(2);
    expect(r[0].kind).toBe(CITY_KIND.approved);
    expect(r[0].day).toBe(F + 100);
    expect(r[0].homes).toBe(40);
    // Float32 lng/lat: within a metre of the weighted centre.
    expect(r[0].anchor[0]).toBeCloseTo((10 * a[0] + 30 * b[0]) / 40, 5);
    expect(r[0].anchor[1]).toBeCloseTo((10 * a[1] + 30 * b[1]) / 40, 5);
    expect(r[0].square).toEqual(citySquare(cityGroup(...C)));
    expect(r[1].day).toBe(F + CITY_BUCKET_DAYS);
    expect(r[1].homes).toBe(5);
    // Zero homes: the plain centre.
    const z = buildCity(
      store(2, [
        { row: 0, at: a, days: [N, F + 1, N], homes: 0 },
        { row: 1, at: b, days: [N, F + 2, N], homes: 0 }
      ]),
      F
    );
    expect(z[0].anchor[0]).toBeCloseTo((a[0] + b[0]) / 2, 5);
    expect(z[0].day).toBe(F + 2);
  });

  it('a merged record never shows before its last contributing event', () => {
    const s = store(3, [
      { row: 0, at: C, days: [N, F + 5, N] },
      { row: 1, at: C, days: [N, F + 170, N] },
      { row: 2, at: C, days: [N, F + 60, N] }
    ]);
    const [r] = buildCity(s, F);
    expect(r.day).toBe(F + 170);
    expect(evalCity(r, F + 169, 13, IN, false).mode).toBe('none');
    expect(evalCity(r, F + 170, 13, IN, false).mode).toBe('ring');
  });

  it("a flagged marker's events go to the policy record, not their stage's", () => {
    const s = store(2, [
      { row: 0, at: C, days: [F + 1, F + 2, F + 3], flags: SLOT_FLAG.zoning },
      { row: 1, at: C, days: [N, F + 4, N] }
    ]);
    const r = buildCity(s, F);
    expect(r.map((x) => [x.kind, x.day, x.homes])).toEqual([
      [CITY_KIND.started, F + 4, 10],
      [CITY_KIND.policy, F + 3, 30]
    ]);
  });

  it('events on or before from make no record; a marker with no days makes none', () => {
    const s = store(3, [
      { row: 0, at: C, days: [F, F - 100, N] },
      { row: 1, at: C, days: [N, N, N] },
      { row: 2, at: C, days: [F, F + 1, N] }
    ]);
    const r = buildCity(s, F);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: CITY_KIND.started, day: F + 1 });
    for (const x of r) expect(x.day).toBeGreaterThan(F);
  });

  it('records are in square, bucket, kind order', () => {
    const far = off(C, 3 * CITY_CELL_M);
    const s = store(4, [
      { row: 0, at: far, days: [F + 1, N, N] },
      { row: 1, at: C, days: [N, F + 200, F + 10] },
      { row: 2, at: C, days: [F + 20, N, N] },
      { row: 3, at: C, days: [N, N, N] }
    ]);
    const r = buildCity(s, F);
    const key = (x: CityAttrs) => [
      cityGroup(...x.anchor),
      Math.floor((x.day - F) / CITY_BUCKET_DAYS),
      x.kind
    ];
    const keys = r.map(key);
    const sorted = [...keys].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    expect(keys).toEqual(sorted);
    expect(keys).toHaveLength(4);
  });

  it('30,000 synthetic markers make at most squares × half-years × 4 records', () => {
    // The synthetic timeline's shape: its grid of sites, its day range, one in ten flagged.
    const rnd = mulberry32(1);
    const n = 30_000;
    const grid = cityGrid(n, 1500);
    const ms: M[] = [];
    const span = SYNTHETIC_END - SYNTHETIC_START;
    const day = (d: number) => (d <= SYNTHETIC_END ? d : N);
    for (let i = 0; i < n; i++) {
      const at = gridSite(grid, Math.floor(i / 1500), i % 1500, rnd);
      const a = SYNTHETIC_START + 1 + Math.floor(rnd() * span);
      const st = a + 30 + Math.floor(rnd() * 510);
      const co = st + 360 + Math.floor(rnd() * 540);
      ms.push({
        row: i,
        at,
        days: [a, day(st), day(co)],
        homes: 1 + Math.floor(rnd() * 200),
        flags: i % 10 === 0 ? SLOT_FLAG.zoning : 0
      });
    }
    const s = store(n, ms);
    expect(s.size).toBe(n);
    expect(s.flagged).toBe(n / 10);
    const r = buildCity(s, SYNTHETIC_START);
    const squares = CITY_GRID.cols * CITY_GRID.rows;
    const halfYears = Math.ceil(span / CITY_BUCKET_DAYS);
    expect(squares).toBe(546);
    expect(halfYears).toBe(49);
    expect(r.length).toBeLessThanOrEqual(squares * halfYears * 4);
    // Measured: 30,000 markers make 43,461 records (the bound is 107,016); the synthetic
    // timeline's per-project rings were 72,532 records (map-citywide plan, Measured).
    expect(r.length).toBe(SYNTHETIC_RECORDS);
  });
});

/** buildCity's record count for the 30,000-marker case above (measured, deterministic). */
const SYNTHETIC_RECORDS = 43_461;

describe('sizes', () => {
  it('cityRadiusPx: 22 up to 50 homes, grows with the square root, 40 at most; cityEdgePx is half', () => {
    expect(cityRadiusPx(0)).toBe(HALO_R_PX[1]);
    expect(cityRadiusPx(50)).toBe(HALO_R_PX[1]);
    expect(cityRadiusPx(150)).toBeCloseTo(HALO_R_PX[1] * Math.sqrt(3), 6);
    expect(cityRadiusPx(200)).toBe(CITY_R_MAX_PX);
    expect(cityRadiusPx(100)).toBeCloseTo(HALO_R_PX[1] * Math.SQRT2, 6);
    expect(cityRadiusPx(10_000)).toBe(CITY_R_MAX_PX);
    expect(cityEdgePx(100)).toBe(cityRadiusPx(100) / 2);
  });
});

describe('edgeOf', () => {
  it('edgeOf: null in view; the edge point toward an anchor off each side and each corner; mirrored behind the camera', () => {
    expect(edgeOf([0, 0, 1])).toBeNull();
    expect(edgeOf([2, 2, 2])).toBeNull(); // on the corner: in view
    expect(edgeOf([4, 1, 2])).toEqual([1, 0.25]);
    expect(edgeOf([-3, 0, 1])).toEqual([-1, 0]);
    expect(edgeOf([0, 2, 1])).toEqual([0, 1]);
    expect(edgeOf([1, -4, 2])).toEqual([0.25, -1]);
    expect(edgeOf([3, 3, 1])).toEqual([1, 1]);
    expect(edgeOf([-3, -6, 1])).toEqual([-0.5, -1]);
    // Behind the camera: (−x, −y), normalised.
    expect(edgeOf([2, 1, -1])).toEqual([-1, -0.5]);
    expect(edgeOf([0, 0, 0])).toEqual([0, -1]);
    expect(edgeOf([0, 0, -1])).toEqual([0, -1]);
  });

  it('blockOutside: true only when every corner is past the same clip plane', () => {
    expect(blockOutside(BLOCK_OUT)).toBe(true);
    expect(blockOutside(BLOCK_STRADDLE)).toBe(false);
    // Past different planes (around a corner of the view): not wholly outside by this test.
    expect(
      blockOutside([
        [2, 0, 1],
        [0, 2, 1],
        [2, 2, 1],
        [3, 3, 1]
      ])
    ).toBe(false);
    // Every corner behind the camera.
    expect(
      blockOutside([
        [0, 0, -1],
        [1, 0, -2],
        [0, 1, -1],
        [5, 5, -0.5]
      ])
    ).toBe(true);
  });
});

describe('evalCity', () => {
  const D = F + 50;

  it('evalCity: nothing before its day, at any zoom, in view or not', () => {
    for (const zoom of [11, 13.99, 14, 18])
      for (const [clip, block] of [
        [IN, undefined],
        [RIGHT, BLOCK_OUT]
      ] as const)
        expect(evalCity(rec(D), D - 1, zoom, clip, false, block).mode).toBe('none');
    expect(evalCity(rec(D), D, 13, IN, false).mode).toBe('ring');
  });

  it('evalCity in view below 14: a ring from 6 px to cityRadiusPx over CITY_RING_DAYS, fading; none from zoom 14', () => {
    const r = rec(D, 1, 200);
    const R = cityRadiusPx(200);
    expect(evalCity(r, D, 13, IN, false)).toEqual({
      mode: 'ring',
      sizePx: HALO_R_PX[0],
      alpha: 1,
      at: [0, 0]
    });
    const mid = evalCity(r, D + 182, 13, [1, 1, 2], false);
    expect(mid.mode).toBe('ring');
    expect(mid.sizePx).toBeCloseTo(HALO_R_PX[0] + ((R - HALO_R_PX[0]) * 182) / CITY_RING_DAYS, 9);
    expect(mid.alpha).toBeCloseTo(1 - 182 / CITY_RING_DAYS, 9);
    expect(mid.at).toEqual([0.5, 0.5]);
    expect(evalCity(r, D + CITY_RING_DAYS - 1, 13, IN, false).mode).toBe('ring');
    expect(evalCity(r, D + CITY_RING_DAYS, 13, IN, false).mode).toBe('none');
    expect(evalCity(r, D, 13.99, IN, false).mode).toBe('ring');
    expect(evalCity(r, D, CITY_HANDOVER_ZOOM, IN, false).mode).toBe('none');
    expect(evalCity(r, D, 16, IN, false).mode).toBe('none');
  });

  it('evalCity off view at any zoom: an edge glow of cityEdgePx for CITY_EDGE_DAYS, fading', () => {
    const r = rec(D, 2, 100);
    for (const zoom of [11, 13, 13.99, 14, 16, 18]) {
      const e = evalCity(r, D + 91, zoom, RIGHT, false, BLOCK_OUT);
      expect(e.mode).toBe('edge');
      expect(e.sizePx).toBe(cityEdgePx(100));
      expect(e.alpha).toBeCloseTo(1 - 91 / CITY_EDGE_DAYS, 9);
      expect(e.at).toEqual([1, 0.25]);
      expect(evalCity(r, D, zoom, RIGHT, false, BLOCK_OUT).alpha).toBe(1);
      expect(evalCity(r, D + CITY_EDGE_DAYS - 1, zoom, RIGHT, false, BLOCK_OUT).mode).toBe('edge');
      expect(evalCity(r, D + CITY_EDGE_DAYS, zoom, RIGHT, false, BLOCK_OUT).mode).toBe('none');
    }
  });

  it('evalCity from zoom 14: an edge glow only for a square wholly outside the view by one square', () => {
    const r = rec(D);
    // The anchor is off view but its margin block reaches into the view: a project of the square
    // may still ring on screen, so no glow from 14 (and none without a block).
    expect(evalCity(r, D, CITY_HANDOVER_ZOOM, RIGHT, false, BLOCK_STRADDLE).mode).toBe('none');
    expect(evalCity(r, D, CITY_HANDOVER_ZOOM, RIGHT, false).mode).toBe('none');
    expect(evalCity(r, D, 17, RIGHT, false, BLOCK_STRADDLE).mode).toBe('none');
    // Below 14 the merged ring hands over to no project ring, so any anchor off view glows.
    expect(evalCity(r, D, 13.99, RIGHT, false, BLOCK_STRADDLE).mode).toBe('edge');
    expect(evalCity(r, D, 13.99, RIGHT, false).mode).toBe('edge');
    expect(evalCity(r, D, CITY_HANDOVER_ZOOM, RIGHT, false, BLOCK_OUT).mode).toBe('edge');
  });

  it('evalCity reduced: a still ring at cityRadiusPx and a still glow, full strength, the same windows', () => {
    const r = rec(D, 0, 120);
    for (const age of [0, 182, CITY_RING_DAYS - 1])
      expect(evalCity(r, D + age, 13, IN, true)).toEqual({
        mode: 'ring',
        sizePx: cityRadiusPx(120),
        alpha: 1,
        at: [0, 0]
      });
    expect(evalCity(r, D + CITY_RING_DAYS, 13, IN, true).mode).toBe('none');
    for (const age of [0, CITY_EDGE_DAYS - 1])
      expect(evalCity(r, D + age, 13, RIGHT, true, BLOCK_OUT)).toMatchObject({
        mode: 'edge',
        sizePx: cityEdgePx(120),
        alpha: 1
      });
    expect(evalCity(r, D + CITY_EDGE_DAYS, 13, RIGHT, true, BLOCK_OUT).mode).toBe('none');
  });

  it('every kind draws in a halo token: the stage tones of HALO_TOKEN, the policy accent', () => {
    expect(CITY_KIND_TOKEN).toEqual([
      HALO_TOKEN.approved,
      HALO_TOKEN.started,
      HALO_TOKEN.completed,
      'tl-halo-policy'
    ]);
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
    // Rows 1 and 4 merge (approved, one square and half-year); row 2 is a policy record.
    expect(buildCity(s, F).map((r) => [r.kind, r.day, r.homes])).toEqual([
      [CITY_KIND.approved, F + 7, 20],
      [CITY_KIND.policy, F + 8, 10]
    ]);
    expect(s.days[3 * 1 + CITY_DAY.approved]).toBe(F + 7);
    expect(s.has[5]).toBe(0);
    // Replace: only the delta's markers remain.
    s.apply(delta(9, [{ row: 8, at: C, days: [F + 9, N, N] }]), true);
    expect([s.size, s.flagged]).toEqual([1, 0]);
    expect(buildCity(s, F).map((r) => r.day)).toEqual([F + 9]);
    s.clear();
    expect([s.size, s.flagged]).toEqual([0, 0]);
    expect(buildCity(s, F)).toEqual([]);
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
    // Rows 1 and 4 merge; none of the forgotten rows' homes or days survive.
    expect(buildCity(s, F).map((r) => [r.kind, r.day, r.homes])).toEqual([
      [CITY_KIND.approved, F + 40, 20]
    ]);
  });

  it('CityStore.apply rejects a malformed delta and leaves the store as it was', () => {
    const s = store(3, [{ row: 1, at: C, days: [F + 1, N, N] }]);
    const before = buildCity(s, F);
    const bad = delta(3, [{ row: 2, at: C, days: [F + 5, N, N] }], 0);
    bad.days = new Float32Array(2);
    expect(() => s.apply(bad, false)).toThrow(RangeError);
    expect(() => s.apply(delta(2, [{ row: 2, at: C, days: [F, N, N] }]), true)).toThrow(RangeError);
    expect([s.size, s.flagged]).toEqual([1, 0]);
    expect(buildCity(s, F)).toEqual(before);
  });
});
