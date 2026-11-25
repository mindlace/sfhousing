/**
 * The mini city's Census population (car-ownership plan Task 7): hand-made test data in the
 * layouts `pipeline/sources/census.ts` writes, so the fixture build runs the car step and fixture-0
 * carries cars.bin, car-zones.json and calibration.json `cars`. Every number here is invented test
 * data (evidence tier 4), not a Census figure; the block-group, tract and PUMA codes are made up.
 *
 * Three 2020 block groups in one tract and one PUMA: 1 holds lots 1 to 6 and the lots west and
 * north of them, 2 lots 7 to 12, 3 lots 13, 14 and 18 and the shoreline lots 15 to 17. Every lot
 * falls in one. Each group's B25044 puts a sixth or more of its households at 3+ cars, so every
 * zone of the few start households holds every car level: a zone missing one would send the zone
 * fit's coefficients to infinity. The ACS 2020-2024 tables, B25044's margins of error, the PUMS
 * households and the TIGER shapefile follow (the zip's .dbf carries a fixed date so the bytes are
 * stable).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { B19001_EDGES } from '../../../lib/cars/config';
import { openDuck } from '../../../lib/duck';

export const MINI_TRACT = '06075990100';
export const MINI_PUMA = '07507';
const BG = (n: number) => `${MINI_TRACT}${n}`;

/** [w, s, e, n] in NAD83 lng/lat, and ALAND in m² (the third group's water left out). */
const BLOCK_GROUPS: { geoid: string; box: [number, number, number, number]; aland: number }[] = [
  { geoid: BG(1), box: [-122.421, 37.759, -122.4188, 37.7615], aland: 52_000 },
  { geoid: BG(2), box: [-122.4188, 37.759, -122.41815, 37.7615], aland: 16_000 },
  { geoid: BG(3), box: [-122.41815, 37.759, -122.4085, 37.7615], aland: 150_000 }
];

/**
 * Per block group: homes and occupied (B25002); B25044 owner and renter by 0, 1, 2, 3, 4, 5+
 * vehicles; B25009 owner and renter by 1 to 7+ persons; B19001's 16 brackets; B08301 workers.
 */
const ACS: {
  homes: number;
  occupied: number;
  owner: number[];
  renter: number[];
  ownerSize: number[];
  renterSize: number[];
  income: number[];
  workers: number;
}[] = [
  {
    homes: 520,
    occupied: 480,
    owner: [20, 50, 45, 20, 10, 5],
    renter: [110, 120, 60, 25, 10, 5],
    ownerSize: [40, 55, 30, 15, 6, 3, 1],
    renterSize: [150, 110, 40, 20, 5, 3, 2],
    income: [30, 15, 15, 15, 15, 15, 15, 15, 15, 30, 40, 60, 55, 45, 40, 60],
    workers: 600
  },
  {
    homes: 400,
    occupied: 380,
    owner: [10, 50, 45, 25, 10, 0],
    renter: [80, 90, 45, 15, 10, 0],
    ownerSize: [45, 50, 25, 10, 6, 3, 1],
    renterSize: [130, 70, 25, 10, 3, 1, 1],
    income: [25, 15, 15, 15, 15, 15, 15, 15, 15, 25, 30, 45, 40, 35, 25, 35],
    workers: 520
  },
  {
    homes: 700,
    occupied: 650,
    owner: [20, 90, 90, 30, 15, 5],
    renter: [150, 150, 60, 25, 15, 0],
    ownerSize: [70, 90, 50, 25, 10, 3, 2],
    renterSize: [200, 130, 45, 15, 6, 2, 2],
    income: [40, 20, 20, 20, 20, 20, 20, 20, 20, 40, 50, 80, 70, 70, 60, 80],
    workers: 800
  }
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const cell = (table: string, i: number) => `${table}_${String(i).padStart(3, '0')}`;

/** `census-acs5-bg-2024.csv`: geoid,variable,estimate. */
function acsRows(): string[] {
  const rows: string[] = [];
  ACS.forEach((a, z) => {
    const g = BLOCK_GROUPS[z].geoid;
    const tenure = sum(a.owner) + sum(a.renter);
    if (
      tenure !== a.occupied ||
      sum(a.ownerSize) !== sum(a.owner) ||
      sum(a.renterSize) !== sum(a.renter) ||
      sum(a.income) !== a.occupied
    )
      throw new Error(`census-raw: block group ${g}'s tables disagree on households`);
    const v: [string, number][] = [
      ['B08301_001', a.workers],
      ['B19001_001', a.occupied],
      ...a.income.map((x, i): [string, number] => [cell('B19001', 2 + i), x]),
      ['B25002_001', a.homes],
      ['B25002_002', a.occupied],
      ['B25002_003', a.homes - a.occupied],
      ['B25009_001', a.occupied],
      ['B25009_002', sum(a.ownerSize)],
      ...a.ownerSize.map((x, i): [string, number] => [cell('B25009', 3 + i), x]),
      ['B25009_010', sum(a.renterSize)],
      ...a.renterSize.map((x, i): [string, number] => [cell('B25009', 11 + i), x]),
      ['B25044_001', a.occupied],
      ['B25044_002', sum(a.owner)],
      ...a.owner.map((x, i): [string, number] => [cell('B25044', 3 + i), x]),
      ['B25044_009', sum(a.renter)],
      ...a.renter.map((x, i): [string, number] => [cell('B25044', 10 + i), x])
    ];
    for (const [k, x] of v) rows.push(`${g},${k},${x}`);
  });
  return rows.sort();
}

/** `census-acs5-bg-moe-2024.csv`: B25044's 90% margins (a zero cell's is the Census 13). */
function moeRows(): string[] {
  const rows: string[] = [];
  for (const r of acsRows()) {
    const [g, k, x] = r.split(',');
    if (!k.startsWith('B25044_')) continue;
    const est = Number(x);
    rows.push(`${g},${k},${est === 0 ? 13 : Math.round(10 + 2.5 * Math.sqrt(est))}`);
  }
  return rows;
}

/** A deterministic generator (an LCG), so the PUMS sample needs no seedless randomness. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pick = (u: number, weights: number[]) => {
  const t = sum(weights);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / t;
    if (u < acc) return i;
  }
  return weights.length - 1;
};

/** YRBLT codes (2020 on): decades before 2020, then single years. */
const YRBLT = [1939, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2021, 2022, 2023, 2024];

/**
 * `census-pums5-2024.csv`: 160 households in the one PUMA, with every tenure by vehicles class,
 * tenure by size class and income bracket the block groups control present, varied incomes (the
 * quartile band edges must differ), and recent movers into homes built since 2010 at incomes
 * across the AMI tiers.
 */
function pumsRows(): string[] {
  const u = lcg(20261124);
  const rows: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 160; i++) {
    const owner = u() < 0.38;
    const ten = owner ? (u() < 0.3 ? 2 : 1) : u() < 0.05 ? 4 : 3;
    const np = 1 + pick(u(), [35, 30, 15, 12, 8]);
    const workers = Math.min(np, pick(u(), [25, 45, 25, 5]));
    const bracket = Math.floor(u() * B19001_EDGES.length);
    const lo = B19001_EDGES[bracket];
    // Inside the bracket: the narrowest is $5,000 wide; the top one is open.
    const hincp = lo + 500 + Math.floor(u() * 8) * (bracket === 15 ? 25_000 : 500);
    // More cars with more income, people and owning; fewer for renters.
    const score = bracket / 15 + (np - 1) / 4 + (owner ? 0.5 : 0) + 0.2 * workers;
    const level = pick(u(), [Math.max(0.2, 1.6 - score), 1.4, 0.4 + score / 2, 0.15 + score / 5]);
    const vehicles = level === 3 ? 3 + Math.floor(u() * 3) : level;
    const mv = 1 + pick(u(), [18, 10, 12, 20, 15, 15, 10]);
    const ybl = YRBLT[pick(u(), [30, 6, 6, 6, 6, 6, 6, 6, 8, 4, 4, 4, 4, 4])];
    const wgtp = 5 + Math.floor(u() * 40);
    seen.add(`v${owner ? 0 : 1}${level}`);
    seen.add(`s${owner ? 0 : 1}${Math.min(np, 4)}`);
    seen.add(`i${bracket}`);
    rows.push(
      [
        MINI_PUMA,
        2020,
        `2024HU${String(i + 1).padStart(7, '0')}`,
        wgtp,
        vehicles,
        mv,
        np,
        workers,
        hincp,
        ten,
        ybl,
        'YRBLT'
      ].join(',')
    );
  }
  const need = [
    ...[0, 1].flatMap((t) => [0, 1, 2, 3].map((k) => `v${t}${k}`)),
    ...[0, 1].flatMap((t) => [1, 2, 3, 4].map((k) => `s${t}${k}`)),
    ...B19001_EDGES.map((_, i) => `i${i}`)
  ];
  const missing = need.filter((k) => !seen.has(k));
  if (missing.length > 0) throw new Error(`census-raw: PUMS sample lacks ${missing.join(', ')}`);
  return rows;
}

/** The TIGER 2020 block-group zip: a real shapefile, its .dbf date fixed for stable bytes. */
async function tigerZip(): Promise<Uint8Array> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-mini-tiger-'));
  const db = await openDuck();
  try {
    const values = BLOCK_GROUPS.map(({ geoid, box: [w, s, e, n], aland }) => {
      const wkt = `POLYGON((${w} ${s},${w} ${n},${e} ${n},${e} ${s},${w} ${s}))`;
      return `('06','075','${geoid.slice(5, 11)}','${geoid.slice(11)}','${geoid}',${aland}::BIGINT,0::BIGINT,ST_GeomFromText('${wkt}'))`;
    });
    await db.run(
      `COPY (SELECT * FROM (VALUES ${values.join(',')})
         t(STATEFP, COUNTYFP, TRACTCE, BLKGRPCE, GEOID, ALAND, AWATER, geom))
       TO '${path.join(work, 'tl_2020_06_bg.shp')}'
       (FORMAT GDAL, DRIVER 'ESRI Shapefile', SRS 'EPSG:4269')`
    );
    const parts: Record<string, [Uint8Array, { mtime: Date }]> = {};
    for (const ext of ['dbf', 'prj', 'shp', 'shx']) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(work, `tl_2020_06_bg.${ext}`)));
      // dBASE header bytes 1-3: the date of last update (YY since 1900, MM, DD).
      if (ext === 'dbf') bytes.set([126, 10, 10], 1);
      parts[`tl_2020_06_bg.${ext}`] = [bytes, { mtime: new Date('2026-10-10T00:00:00Z') }];
    }
    return zipSync(parts, { level: 9 });
  } finally {
    db.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export interface CensusPage {
  id: string;
  name: string;
  body: Uint8Array;
  rowCount: number;
}

const csv = (header: string, rows: string[]) => strToU8(`${header}\n${rows.join('\n')}\n`);

/** The mini Census raw files, one per lock id, in the layouts the fetchers write. */
export async function censusPages(): Promise<CensusPage[]> {
  const acs = acsRows();
  const moe = moeRows();
  const pums = pumsRows();
  return [
    {
      id: 'census-acs5-bg-2024',
      name: 'census-acs5-bg-2024.csv',
      body: csv('geoid,variable,estimate', acs),
      rowCount: acs.length
    },
    {
      id: 'census-acs5-bg-moe-2024',
      name: 'census-acs5-bg-moe-2024.csv',
      body: csv('geoid,variable,moe', moe),
      rowCount: moe.length
    },
    {
      id: 'census-pums5-2024',
      name: 'census-pums5-2024.csv',
      body: csv(
        'puma,puma_vintage,serialno,wgtp,veh,mv,np,workers,hincp_adj,ten,ybl,ybl_src',
        pums
      ),
      rowCount: pums.length
    },
    {
      id: 'census-puma-2020',
      name: 'census-puma-2020.csv',
      body: csv('tract,puma', [`${MINI_TRACT},${MINI_PUMA}`]),
      rowCount: 1
    },
    {
      id: 'census-tiger-bg-2020',
      name: 'census-tiger-bg-2020.zip',
      body: await tigerZip(),
      rowCount: BLOCK_GROUPS.length
    }
  ];
}
