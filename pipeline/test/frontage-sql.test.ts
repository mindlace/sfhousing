// 83_frontage.sql on a synthetic block in EPSG:7131 metres: every case is an exact fr_front row set.
// Local coordinates are offset from O (the mini fixture's origin); the streets go into src_streets
// as lng/lat, as normalise writes them, and the SQL projects them back.
import { beforeAll, describe, expect, it } from 'vitest';
import { SQL_VARS } from '../config';
import { openDuck, type Duck } from '../lib/duck';
import { runFrontageSql } from '../steps/frontage';

type Box = [x0: number, y0: number, x1: number, y1: number];
const LOTS: Record<string, Box> = {
  C: [0, 0, 20, 30], // corner: SOUTH ST below, WEST ST to its left
  I: [20, 0, 30, 30], // interior, beside C
  R: [20, 30, 30, 60], // rear, behind I
  T: [40, 0, 50, 60], // through lot: SOUTH ST and NORTH ST
  P: [60, 0, 100, 60], // park-sized lot on SOUTH ST
  Q: [60, 60, 100, 90], // behind P, 68 m from SOUTH ST
  B: [200, 0, 210, 30], // 30 m from BOULEVARD, nothing between
  F: [300, 15, 310, 45] // 45 m from BOULEVARD
};
type Street = [cnn: number, name: string, classcode: number, layer: string, line: number[][]];
const STREETS: Street[] = [
  [
    10,
    'SOUTH ST',
    3,
    'STREETS',
    [
      [-20, -8],
      [110, -8]
    ]
  ],
  [
    20,
    'WEST ST',
    5,
    'STREETS',
    [
      [-8, -20],
      [-8, 25]
    ]
  ],
  [
    30,
    'NORTH ST',
    5,
    'STREETS',
    [
      [35, 68],
      [55, 68]
    ]
  ],
  [
    40,
    'BOULEVARD',
    2,
    'STREETS',
    [
      [190, -30],
      [320, -30]
    ]
  ],
  // Beside I, between it and SOUTH ST: dropped by classcode (freeway) and by layer (PAPER).
  [
    50,
    'FREEWAY',
    1,
    'STREETS',
    [
      [18, -3],
      [32, -3]
    ]
  ],
  [
    60,
    'PAPER ST',
    5,
    'PAPER',
    [
      [18, -5],
      [32, -5]
    ]
  ]
];

let db: Duck;
let front: { id: string; seg_idx: number; depth: number }[];

beforeAll(async () => {
  db = await openDuck();
  const [o] = await db.all<{ x: number; y: number }>(
    `SELECT ST_X(g) x, ST_Y(g) y FROM (SELECT ST_Transform(ST_Point(-122.4195, 37.76),
       'EPSG:4326', 'EPSG:7131', always_xy := true) g)`
  );
  const pt = ([x, y]: number[]) => `${o.x + x} ${o.y + y}`;
  const box = ([x0, y0, x1, y1]: Box) =>
    `POLYGON((${[
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0]
    ]
      .map(pt)
      .join(', ')}))`;
  await db.run('CREATE TABLE parcels (id VARCHAR, geom_orig GEOMETRY)');
  for (const [id, b] of Object.entries(LOTS))
    await db.run(`INSERT INTO parcels VALUES ('${id}', ST_GeomFromText('${box(b)}'))`);
  await db.run(
    'CREATE TABLE src_streets (cnn BIGINT, streetname VARCHAR, classcode INTEGER, layer VARCHAR, geom GEOMETRY)'
  );
  for (const [cnn, name, cls, layer, line] of STREETS)
    await db.run(
      `INSERT INTO src_streets VALUES (${cnn}, '${name}', ${cls}, '${layer}',
         ST_Transform(ST_GeomFromText('MULTILINESTRING((${line.map(pt).join(', ')}))'),
           'EPSG:7131', 'EPSG:4326', always_xy := true))`
    );
  await runFrontageSql(db);
  front = await db.all('SELECT id, seg_idx, depth FROM fr_front');
});

const rows = (id: string) => front.filter((r) => r.id === id).map((r) => [r.seg_idx, r.depth]);

describe('83_frontage.sql on a synthetic block', () => {
  it('pins the matching SQL_VARS', () => {
    expect([
      SQL_VARS.front_max_m,
      SQL_VARS.front_tol_m,
      SQL_VARS.front_min_m,
      SQL_VARS.occlude_min_m,
      SQL_VARS.adjacent_min_m
    ]).toEqual([40, 2, 5, 0.5, 3]);
  });

  it('keeps the classcode 2-5 segments off PAPER layers, indexed by cnn', async () => {
    expect(await db.all('SELECT seg_idx, cnn, name, class FROM fr_seg ORDER BY seg_idx')).toEqual([
      { seg_idx: 0, cnn: 10, name: 'SOUTH ST', class: 3 },
      { seg_idx: 1, cnn: 20, name: 'WEST ST', class: 5 },
      { seg_idx: 2, cnn: 30, name: 'NORTH ST', class: 5 },
      { seg_idx: 3, cnn: 40, name: 'BOULEVARD', class: 2 }
    ]);
  });

  it('orders fr_front by id, depth, seg_idx', () => {
    const key = (r: (typeof front)[number]) => [r.id, r.depth, r.seg_idx];
    const sorted = [...front].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
      return 0;
    });
    expect(front).toEqual(sorted);
  });

  it('gives a corner lot depth 0 on both streets', () => {
    expect(rows('C')).toEqual([
      [0, 0],
      [1, 0]
    ]);
  });

  it('gives the interior lot depth 0 on its street, and one lot deep off the corner’s side street', () => {
    // I's side edge faces WEST ST through C: the second lot from the corner (mini lot 13 likewise).
    expect(rows('I')).toEqual([
      [0, 0],
      [1, 1]
    ]);
  });

  it('gives the rear lot depth 1 on the street its neighbour fronts', () => {
    expect(rows('R')).toEqual([[0, 1]]);
  });

  it('gives a through lot depth 0 on both streets', () => {
    expect(rows('T')).toEqual([
      [0, 0],
      [2, 0]
    ]);
  });

  it('fronts a lot 30 m from a centerline with no parcel between, not one 45 m away', () => {
    expect(rows('B')).toEqual([[3, 0]]);
    expect(rows('F')).toEqual([]);
  });

  it('gives a park depth 0 and the lot behind it, beyond front_max_m, depth 1', () => {
    expect(rows('P')).toEqual([[0, 0]]);
    expect(rows('Q')).toEqual([[0, 1]]);
  });

  it('never matches the freeway or PAPER segment', () => {
    expect(front).toHaveLength(10);
    expect(new Set(front.map((r) => r.seg_idx))).toEqual(new Set([0, 1, 2, 3]));
  });
});
