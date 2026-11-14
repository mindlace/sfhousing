import { describe, expect, it } from 'vitest';
import { BOXES } from '../boxes-config.js';
import type { MultiPoly, Ring } from '../geom.js';
import { createTableFromRows, openDuck } from '../lib/duck.js';
import { clusterBuildings } from '../lib/lidar/clusters.js';
import {
  analysePeak,
  registerCluster,
  registrationBbox,
  scoreGrid,
  shiftFromGrid,
  type Footprint
} from '../lib/lidar/register.js';
import { runSql } from '../lib/sql.js';
import { openMiniDuck } from './helpers.js';
import { synthWindow, type SynthScene } from './lidar-synth.js';

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
];

const ground = (x: number, y: number): number => 12 + 0.01 * x - 0.02 * y;

const fp = (bid: string, ring: Ring, heightM = 9): Footprint => ({
  bid,
  shape: [[ring]],
  heightM,
  baseM: 0,
  hs: 0
});

/** The synthetic window a caller would cut for these members. */
const windowFor = (scene: SynthScene, members: Footprint[]) =>
  synthWindow(scene, registrationBbox(members));

const disc = (cx: number, cy: number, r: number, n = 24): Ring =>
  Array.from({ length: n }, (_, k): [number, number] => [
    cx + r * Math.cos((2 * Math.PI * k) / n),
    cy + r * Math.sin((2 * Math.PI * k) / n)
  ]);

describe('registerCluster', () => {
  it("recovers a detached building's shift", () => {
    const ring = rect(100, 200, 112, 220);
    const scene: SynthScene = { ground, boxes: [{ ring, top: 9 }], shift: [1.24, -0.32] };
    const members = [fp('a', ring)];
    const s = registerCluster(windowFor(scene, members), members);
    expect(s).not.toBeNull();
    expect(s!.source).toBe('fit');
    expect(Math.abs(s!.dx - 1.24)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(s!.dy + 0.32)).toBeLessThanOrEqual(0.1);
    expect(s!.flagged).toBe(false);
    expect(s!.score).toBeGreaterThan(0);
    expect(s!.atEdge).toBe(false);
    expect(s!.ratio).toBeLessThan(0.85);
  });

  it('tolerates eaves', () => {
    const ring = rect(100, 200, 112, 220);
    const eaves = rect(99.6, 199.6, 112.4, 220.4);
    const scene: SynthScene = { ground, boxes: [{ ring: eaves, top: 9 }], shift: [0.6, 0.2] };
    const members = [fp('a', ring)];
    const s = registerCluster(windowFor(scene, members), members)!;
    expect(s.source).toBe('fit');
    expect(s.flagged).toBe(false);
    expect(Math.abs(s.dx - 0.6)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(s.dy - 0.2)).toBeLessThanOrEqual(0.15);
    // The opposite walls give close maxima; the shift between them still scores well.
    expect(s.score).toBeGreaterThanOrEqual(BOXES.regPeakFloor * s.best);
  });

  it('a rowhouse block fits as one', () => {
    const houses = Array.from({ length: 6 }, (_, k) =>
      fp(`h${k}`, rect(100 + 6 * k, 200, 106 + 6 * k, 225))
    );
    const scene: SynthScene = {
      ground,
      boxes: houses.map((h) => ({ ring: h.shape[0][0], top: 9 })),
      shift: [1.1, -0.3]
    };
    const w = windowFor(scene, houses);
    // A house inside the row reads as part of one mass: on its own it is ambiguous.
    for (const h of houses.slice(1, 5)) {
      const alone = registerCluster(w, [h])!;
      expect(alone.ratio >= 0.85 || alone.atEdge).toBe(true);
      expect(alone.source).not.toBe('fit');
    }
    const s = registerCluster(w, houses)!;
    expect(s.source).toBe('fit');
    // The 0.25 m raster draws the row's walls at x 101.0 and 137.0 (cell centres inside
    // [101.1, 137.1)), so the LiDAR itself sits 1.0 m east: exactly 0.1 m off, give or take an ulp.
    expect(Math.abs(s.dx - 1.1)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(Math.abs(s.dy + 0.3)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(s.flagged).toBe(false);
  });

  it('a shift beyond the search falls back flagged', () => {
    const ring = rect(100, 200, 112, 220);
    const scene: SynthScene = { ground, boxes: [{ ring, top: 9 }], shift: [3.6, 0] };
    const members = [fp('a', ring)];
    const s = registerCluster(windowFor(scene, members), members)!;
    expect(s.atEdge).toBe(true);
    expect(s.flagged).toBe(true);
    expect(s.source).not.toBe('fit');
  });

  it('bare ground gives none', () => {
    const ring = rect(100, 200, 112, 220);
    const scene: SynthScene = { ground, boxes: [] };
    const members = [fp('a', ring)];
    const s = registerCluster(windowFor(scene, members), members)!;
    expect(s.source).toBe('none');
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(0);
    expect(s.flagged).toBe(true);
    expect(s.score).toBeLessThanOrEqual(0);
    expect(Number.isFinite(s.ratio)).toBe(true);
    expect(Number.isFinite(s.sharpX)).toBe(true);
  });

  it('a tree beside the building does not pull the fit', () => {
    const ring = rect(100, 200, 112, 220);
    // A crown 2 m across whose edge is 1 m off the east wall, as tall as the house.
    const scene: SynthScene = {
      ground,
      boxes: [{ ring, top: 9 }],
      veg: [{ ring: disc(115, 210, 2), top: 10 }],
      shift: [0.5, 0.7]
    };
    const members = [fp('a', ring)];
    const s = registerCluster(windowFor(scene, members), members)!;
    expect(s.source).toBe('fit');
    expect(Math.abs(s.dx - 0.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(s.dy - 0.7)).toBeLessThanOrEqual(0.1);
  });

  it('a positive best at no shift is zero, not none', () => {
    // A box shifted beyond the search, west and level: the (0,0) candidate still lines up the
    // north and south walls, better than either frame, so it wins with a positive score. A usable,
    // flagged zero shift, apart from `none`.
    const ring = rect(100, 200, 112, 220);
    const scene: SynthScene = { ground, boxes: [{ ring, top: 9 }], shift: [-3.6, 0] };
    const members = [fp('a', ring)];
    const s = registerCluster(windowFor(scene, members), members)!;
    expect(s.source).toBe('zero');
    expect(s.score).toBeGreaterThan(0);
    expect([s.dx, s.dy, s.flagged]).toEqual([0, 0, true]);
  });

  it('no LiDAR coverage gives no shift', () => {
    const ring = rect(100, 200, 112, 220);
    const members = [fp('a', ring)];
    expect(registerCluster(null, members)).toBeNull();
    const scene: SynthScene = { ground, boxes: [], nodata: [rect(80, 180, 132, 240)] };
    expect(registerCluster(windowFor(scene, members), members)).toBeNull();
  });

  it('respects holes: a courtyard edge scores outward from the building', () => {
    const outer = rect(100, 200, 120, 220);
    const hole: Ring = rect(106, 206, 114, 214);
    const shape: MultiPoly = [[outer, hole]];
    // The LiDAR mass is the outer ring less the courtyard, drawn as four bars.
    const scene: SynthScene = {
      ground,
      boxes: [
        { ring: rect(100, 200, 120, 206), top: 9 },
        { ring: rect(100, 214, 120, 220), top: 9 },
        { ring: rect(100, 206, 106, 214), top: 9 },
        { ring: rect(114, 206, 120, 214), top: 9 }
      ],
      shift: [-0.8, 0.4]
    };
    const members: Footprint[] = [{ bid: 'c', shape, heightM: 9, baseM: 0, hs: 0 }];
    const s = registerCluster(windowFor(scene, members), members)!;
    expect(s.source).toBe('fit');
    expect(Math.abs(s.dx + 0.8)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(s.dy - 0.4)).toBeLessThanOrEqual(0.1);
  });
});

describe('scoreGrid and analysePeak', () => {
  it('scores a 61 x 61 grid from -3 to 3 m', () => {
    const ring = rect(100, 200, 112, 220);
    const scene: SynthScene = { ground, boxes: [{ ring, top: 9 }], shift: [-1, 2] };
    const members = [fp('a', ring)];
    const { shifts, S } = scoreGrid(windowFor(scene, members), members, 9);
    expect(shifts).toHaveLength(61);
    expect(shifts[0]).toBeCloseTo(-3, 9);
    expect(shifts[30]).toBeCloseTo(0, 9);
    expect(shifts[60]).toBeCloseTo(3, 9);
    expect(S).toHaveLength(61 * 61);
    const p = analysePeak(shifts, S);
    expect(Math.abs(p.dx + 1)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(p.dy - 2)).toBeLessThanOrEqual(0.1);
    expect(p.atEdge).toBe(false);
    expect(p.sharpX).toBeGreaterThan(0);
    expect(p.sharpX).toBeLessThan(0.5);
  });

  it('refines a peak between grid cells and flags the border', () => {
    const shifts = Float64Array.from({ length: 61 }, (_, k) => (k - 30) / 10);
    const S = new Float64Array(61 * 61);
    for (let iy = 0; iy < 61; iy++)
      for (let ix = 0; ix < 61; ix++)
        S[iy * 61 + ix] = 1 - (shifts[ix] - 0.43) ** 2 - (shifts[iy] + 1.27) ** 2;
    const p = analysePeak(shifts, S);
    expect(Math.abs(p.dx - 0.43)).toBeLessThan(0.02);
    expect(Math.abs(p.dy + 1.27)).toBeLessThan(0.02);
    expect(p.ratio).toBeLessThan(0.85);
    expect(p.atEdge).toBe(false);
    // best is the best cell (0.4, -1.3); score is read at the refined peak.
    expect(p.best).toBeCloseTo(1 - 0.03 ** 2 - 0.03 ** 2, 6);
    expect(p.score).toBeGreaterThan(0.99);
    expect(p.score).toBeLessThanOrEqual(1);
    const edge = new Float64Array(61 * 61);
    for (let iy = 0; iy < 61; iy++)
      for (let ix = 0; ix < 61; ix++) edge[iy * 61 + ix] = shifts[ix] + 0.01 * shifts[iy];
    expect(analysePeak(shifts, edge).atEdge).toBe(true);
  });
});

describe('shiftFromGrid', () => {
  const shifts = Float64Array.from({ length: 61 }, (_, k) => (k - 30) / 10);
  /** A score grid from f(dx, dy). */
  const grid = (f: (dx: number, dy: number) => number): Float64Array => {
    const S = new Float64Array(61 * 61);
    for (let iy = 0; iy < 61; iy++)
      for (let ix = 0; ix < 61; ix++) S[iy * 61 + ix] = f(shifts[ix], shifts[iy]);
    return S;
  };
  const bump = (dx: number, dy: number, x: number, y: number, sigma: number): number =>
    Math.exp(-((dx - x) ** 2 + (dy - y) ** 2) / (2 * sigma * sigma));

  it('two narrow maxima 0.8 m apart are ambiguous, not a fit between them', () => {
    // Away from every candidate so the fallback cannot land near the true maxima by chance.
    const S = grid(
      (dx, dy) => bump(dx, dy, -2.0, 1.5, 0.15) + 0.97 * bump(dx, dy, -1.2, 1.5, 0.15)
    );
    const s = shiftFromGrid(shifts, S);
    expect(s.source).not.toBe('fit');
    expect(s.flagged).toBe(true);
  });

  it('two narrow maxima 1.05 m apart are ambiguous, not a fit between them', () => {
    const S = grid(
      (dx, dy) => bump(dx, dy, -2.0, 1.5, 0.15) + 0.97 * bump(dx, dy, -0.95, 1.5, 0.15)
    );
    const s = shiftFromGrid(shifts, S);
    expect(s.source).not.toBe('fit');
    expect(s.flagged).toBe(true);
  });

  it('one narrow maximum is a confident fit scored where it lands', () => {
    const S = grid((dx, dy) => bump(dx, dy, -1.43, 1.52, 0.15));
    const s = shiftFromGrid(shifts, S);
    expect(s.source).toBe('fit');
    expect(s.flagged).toBe(false);
    expect(Math.abs(s.dx + 1.43)).toBeLessThan(0.05);
    expect(Math.abs(s.dy - 1.52)).toBeLessThan(0.05);
    expect(s.score).toBeGreaterThanOrEqual(BOXES.regPeakFloor * s.best);
  });

  it('a positive grid peak is never none, even when every candidate scores <= 0', () => {
    // Two equal maxima far apart (ambiguous) on a negative floor: (0,0) and both frames read -0.2.
    const S = grid(
      (dx, dy) => -0.2 + bump(dx, dy, 2.5, -2.5, 0.15) + bump(dx, dy, -2.5, 2.5, 0.15)
    );
    const s = shiftFromGrid(shifts, S);
    expect(s.best).toBeGreaterThan(0);
    expect(s.source).toBe('zero');
    expect([s.dx, s.dy, s.flagged]).toEqual([0, 0, true]);
    expect(s.score).toBeLessThanOrEqual(0);
  });

  it('none when the whole grid is <= 0', () => {
    const S = grid((dx, dy) => -0.1 - 0.01 * (dx * dx + dy * dy));
    const s = shiftFromGrid(shifts, S);
    expect(s.source).toBe('none');
    expect([s.dx, s.dy, s.flagged]).toEqual([0, 0, true]);
    expect(s.best).toBeLessThanOrEqual(0);
  });
});

describe('clusterBuildings', () => {
  it('clusters on the mini fixture', async () => {
    const db = await openMiniDuck();
    try {
      await runSql(db);
      const bids = (await db.all<{ bid: string }>('SELECT bid FROM buildings ORDER BY bid')).map(
        (r) => r.bid
      );
      expect(bids).toContain('besri');
      expect(bids).toContain('b06');
      const [{ d }] = await db.all<{ d: number }>(
        `SELECT ST_Distance(a.geom, b.geom) AS d FROM buildings a, buildings b
         WHERE a.bid = 'besri' AND b.bid = 'b06'`
      );
      expect(d).toBeLessThan(1.5);
      const clusters = await clusterBuildings(db);
      expect([...clusters.keys()].sort()).toEqual(bids);
      for (const bid of bids) expect(clusters.get(bid)).toBe(bid);
    } finally {
      db.close();
    }
  });

  it('clusters on hand rows', async () => {
    const db = await openDuck();
    try {
      const sq = (x: number, y: number, s = 10) =>
        `POLYGON((${x} ${y}, ${x + s} ${y}, ${x + s} ${y + s}, ${x} ${y + s}, ${x} ${y}))`;
      // a|b: 1 m apart, parcels 3512001 / 3512002 (block 3512) -> one cluster.
      // c|d: 1 m apart, parcels 3512001 / 3513001 (blocks 3512, 3513) -> two clusters.
      // e|f: 2 m apart, both on block 3520 -> two clusters.
      // g: no parcel piece -> its own cluster.
      // h holds i inside it (distance 0, boundaries 2 m apart), block 3530 -> one cluster.
      // j has equal pieces on blocks 3541 and 3540: the lower parcel id (3540002) is its main
      // parcel, so it joins k (block 3540, 1 m east), not l (block 3541, 1 m west).
      // a, c, e, g share x extents: DuckDB's polygon ST_Distance reads 0 between such squares.
      const rows: [string, string][] = [
        ['a', sq(0, 0)],
        ['b', sq(11, 0)],
        ['c', sq(0, 100)],
        ['d', sq(11, 100)],
        ['e', sq(0, 200)],
        ['f', sq(12, 200)],
        ['g', sq(0, 300)],
        ['h', sq(0, 400, 20)],
        ['i', sq(2, 402, 4)],
        ['j', sq(0, 500)],
        ['k', sq(11, 500)],
        ['l', sq(-11, 500)]
      ];
      await createTableFromRows(
        db,
        'buildings_wkt',
        [
          ['bid', 'VARCHAR'],
          ['wkt', 'VARCHAR']
        ],
        rows
      );
      await db.run(
        'CREATE TABLE buildings AS SELECT bid, ST_GeomFromText(wkt) AS geom FROM buildings_wkt'
      );
      await createTableFromRows(
        db,
        'pieces',
        [
          ['bid', 'VARCHAR'],
          ['parcel_id', 'VARCHAR'],
          ['area_m2', 'DOUBLE']
        ],
        [
          ['a', '3512001', 100],
          ['b', '3512002', 80],
          ['b', '3513009', 20],
          ['c', '3512001', 100],
          ['d', '3513001', 60],
          ['d', '3512003', 40],
          ['e', '3520001', 100],
          ['f', '3520002', 100],
          ['g', null, 100],
          ['h', '3530001', 384],
          ['i', '3530001', 16],
          ['j', '3541001', 50],
          ['j', '3540002', 50],
          ['k', '3540001', 100],
          ['l', '3541005', 100]
        ]
      );
      const clusters = await clusterBuildings(db);
      expect(Object.fromEntries([...clusters].sort())).toEqual({
        a: 'a',
        b: 'a',
        c: 'c',
        d: 'd',
        e: 'e',
        f: 'f',
        g: 'g',
        h: 'h',
        i: 'h',
        j: 'j',
        k: 'j',
        l: 'l'
      });
    } finally {
      db.close();
    }
  });
});
