import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gridLngLat, type AccessGrid } from '../../../src/lib/transit/grid';
import { project } from '../../../src/lib/plan/geometry';
import { zoneAccess } from '../../lib/cars/access';
import { assignZones, zoneFeatures } from '../../lib/cars/zones';
import { openDuck, type Duck } from '../../lib/duck';
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import type { Lock } from '../../lib/lock';
import { carsStep } from '../../steps/cars';
import { CAR_LEVELS, carShares, densityOf, type CarModel } from '../../../src/lib/sim/cars';
import { parseCalibration } from '../../../src/lib/timelapse/model';

/** A lng/lat box as WKT. */
/** The mini fixture's projects.json: its affordable completions by tier sum to 0. */
const PROJECTS = join(import.meta.dirname, '../fixtures/mini/golden/scenarios/fzp/projects.json');

const box = (w: number, s: number, e: number, n: number) =>
  `'POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))'`;

describe('assignZones', () => {
  let db: Duck;
  beforeAll(async () => {
    db = await openDuck();
    // Two 2020 block groups side by side (their order in the table is not the zone order), and
    // a 2010 one that must be ignored.
    await db.run(`CREATE TABLE src_bg_geom AS
      SELECT * FROM (VALUES
        (2020, '060750102002', ${box(-122.42, 37.77, -122.41, 37.78)}, 2000.5),
        (2020, '060750102001', ${box(-122.43, 37.77, -122.42, 37.78)}, 1000.25),
        (2010, '060750102001', ${box(-122.5, 37.7, -122.3, 37.9)}, 9.0)
      ) t(vintage, geoid, wkt, aland)`);
    await db.run(`CREATE OR REPLACE TABLE src_bg_geom AS SELECT vintage, geoid,
      ST_Transform(ST_GeomFromText(wkt), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS geom,
      aland FROM src_bg_geom`);
  });
  afterAll(() => db.close());

  it('orders zones by GEOID, takes land area from TIGER, and gives -1 to a lot in no zone', async () => {
    const lngLat = Float64Array.from([
      -122.415,
      37.775, // in ...002
      -122.425,
      37.775, // in ...001
      -122.3,
      37.6, // in no block group
      -122.428,
      37.771 // in ...001
    ]);
    const r = await assignZones(db, { vintage: 2020, lngLat });
    expect(r.zones).toEqual(['060750102001', '060750102002']);
    expect(Array.from(r.areaM2)).toEqual([1000.25, 2000.5]);
    expect(Array.from(r.lotZone)).toEqual([1, 0, -1, 0]);
    expect(r.counts['cars.lotsNoZone']).toBe(1);
    expect(r.counts['cars.zones']).toBe(2);
  });

  it('writes one GeoJSON feature per zone with its index as z', async () => {
    const fc = await zoneFeatures(db, 2020);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f) => f.properties.z)).toEqual([0, 1]);
    expect(fc.features[0].properties.geoid).toBe('060750102001');
    const ring = (fc.features[0].geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring[0][0]).toBeCloseTo(-122.43, 5);
  });
});

describe('zoneAccess', () => {
  it('is the homes-weighted mean of the grid at each lot, the plain mean with no homes', () => {
    // A 2 x 1 grid: the west cell reads 100, the east 300.
    const origin = project(-122.43, 37.77);
    const grid: AccessGrid = {
      origin,
      sizeM: 100,
      cols: 2,
      rows: 1,
      values: Float32Array.from([100, 300])
    };
    const at = (dx: number) => gridLngLat(grid, dx, 50);
    // Lots at the two cell centres; zone 0 holds both, zone 1 holds the east one with no homes.
    const lngLat = Float64Array.from([...at(50), ...at(150), ...at(150)]);
    const lotZone = Int32Array.from([0, 0, 1]);
    const homes = Int32Array.from([3, 1, 0]);
    const a = zoneAccess(grid, lotZone, homes, lngLat, 3);
    expect(a[0]).toBeCloseTo((3 * 100 + 1 * 300) / 4, 6);
    expect(a[1]).toBeCloseTo(300, 6);
    expect(a[2]).toBe(0);
  });
});

describe('carsStep without census', () => {
  it('returns no data and no model, and writes no file', async () => {
    const db = await openDuck();
    const outDir = mkdtempSync(join(tmpdir(), 'sfh-cars-'));
    const parcels = { count: 0 } as unknown as ScenarioParcels;
    const r = await carsStep(db, { outDir, lock: { sources: [] }, transit: null, parcels });
    expect(r.data).toBeNull();
    expect(r.model).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(readdirSync(outDir)).toEqual([]);
    expect(existsSync(join(outDir, 'scenarios/fzp/cars.bin'))).toBe(false);
    db.close();
  });
});

describe('carsStep with census tables', () => {
  const lock = {
    sources: [
      'census-acs5-bg-2024',
      'census-pums5-2024',
      'census-tiger-bg-2020',
      'census-puma-2020'
    ].map((id) => ({ id, files: [] }))
  } as unknown as Lock;
  // One lot with 10 homes inside the 2020 block group 060750102001.
  const parcels = {
    count: 1,
    labelPoint: Float64Array.from([-122.425, 37.775]),
    existingUnits: Uint16Array.from([10])
  } as unknown as ScenarioParcels;

  async function censusDb(o: { bgVintage: number; occupied: number }): Promise<Duck> {
    const db = await openDuck();
    await db.run(`CREATE TABLE src_bg_geom AS SELECT ${o.bgVintage} AS vintage,
      '060750102001' AS geoid,
      ST_Transform(ST_GeomFromText(${box(-122.43, 37.77, -122.42, 37.78)}), 'EPSG:4326',
        'EPSG:7131', always_xy := true) AS geom, 1000.0 AS aland`);
    await db.run(`CREATE TABLE src_tract_puma AS SELECT 2020 AS vintage,
      '06075010200' AS tract, '07507' AS puma`);
    // One renter household of each car level, all of one type, at an income under half the AMI;
    // two moved in within the year, all into a home built in 2015. Owners at four other incomes
    // (one of each car level, none moved in within the year, in homes built in 1950) spread the
    // weighted quartiles, so the income band edges differ, and share the renters' top band, so
    // the renter term is not one band's.
    await db.run(`CREATE TABLE src_pums_hh AS SELECT 2024 AS release, '07507' AS puma,
      'S' || veh AS serialno, 10 AS wgtp, veh, 2 AS np, 1 AS workers, 50000.0 AS hincp_adj,
      3 AS ten, 2020 AS puma_vintage, CASE WHEN veh < 2 THEN 1 ELSE 4 END AS mv, 2015 AS ybl,
      'YRBLT' AS ybl_src FROM range(4) t(veh)
      UNION ALL SELECT 2024, '07507', 'O' || inc || veh, w, veh, 2, 1, inc::DOUBLE, 1, 2020, 4,
      1950, 'YRBLT' FROM range(4) t(veh),
        (VALUES (5000, 5), (20000, 10), (45000, 10), (90000, 10)) i(inc, w)`);
    await db.run(`CREATE TABLE src_acs_bg AS SELECT * FROM (VALUES
      (2024, '060750102001', 'B25002_001', 10.0),
      (2024, '060750102001', 'B25002_002', ${o.occupied}::DOUBLE)
    ) t(release, geoid, variable, estimate)`);
    return db;
  }

  it("holds the model's shares at month 0: the start is raked to the shrunk shares", async () => {
    // Four block groups in one tract, 1,000 homes each, B25044 shares far apart (one with no
    // 3+ household), and a PUMS seed of owners and renters at each car level.
    const db = await openDuck();
    const geoids = ['060750102001', '060750102002', '060750102003', '060750102004'];
    await db.run(`CREATE TABLE src_bg_geom AS SELECT 2020 AS vintage, geoid,
      ST_Transform(ST_GeomFromText(wkt), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS geom,
      aland FROM (VALUES
        ('${geoids[0]}', ${box(-122.44, 37.77, -122.43, 37.78)}, 50000.0),
        ('${geoids[1]}', ${box(-122.43, 37.77, -122.42, 37.78)}, 100000.0),
        ('${geoids[2]}', ${box(-122.42, 37.77, -122.41, 37.78)}, 200000.0),
        ('${geoids[3]}', ${box(-122.41, 37.77, -122.4, 37.78)}, 400000.0)
      ) t(geoid, wkt, aland)`);
    await db.run(`CREATE TABLE src_tract_puma AS SELECT 2020 AS vintage,
      '06075010200' AS tract, '07507' AS puma`);
    await db.run(`CREATE TABLE src_pums_hh AS SELECT 2024 AS release, '07507' AS puma,
      'S' || veh || ten AS serialno, 10 + veh AS wgtp, veh, 2 AS np, 1 AS workers,
      50000.0 AS hincp_adj, ten, 2020 AS puma_vintage, CASE WHEN veh < 2 THEN 1 ELSE 4 END AS mv,
      2015 AS ybl, 'YRBLT' AS ybl_src
      FROM range(4) a(veh), (VALUES (1), (3)) b(ten)`);
    // B25044 owner 0/1/2/3 cars (cells 003-006) and renter (010-013) per zone.
    const b25044 = [
      [10, 40, 30, 20, 200, 150, 40, 10],
      [30, 100, 60, 10, 300, 100, 20, 0],
      [60, 150, 40, 5, 400, 60, 10, 0],
      [20, 200, 150, 80, 60, 80, 40, 20]
    ];
    const cell = (k: number) => `B25044_${String(k < 4 ? 3 + k : 6 + k).padStart(3, '0')}`;
    const rows = geoids.flatMap((g, z) => [
      `(2024, '${g}', 'B25002_001', 1000.0)`,
      `(2024, '${g}', 'B25002_002', 900.0)`,
      `(2024, '${g}', 'B25044_001', ${b25044[z].reduce((x, y) => x + y, 0)}.0)`,
      ...b25044[z].map((v, k) => `(2024, '${g}', '${cell(k)}', ${v}.0)`)
    ]);
    await db.run(`CREATE TABLE src_acs_bg AS SELECT * FROM (VALUES ${rows.join(', ')})
      t(release, geoid, variable, estimate)`);
    const four = {
      count: 4,
      labelPoint: Float64Array.from([
        -122.435, 37.775, -122.425, 37.775, -122.415, 37.775, -122.405, 37.775
      ]),
      existingUnits: Uint16Array.from([1000, 1000, 1000, 1000])
    } as unknown as ScenarioParcels;
    const outDir = mkdtempSync(join(tmpdir(), 'sfh-cars-'));
    const r = await carsStep(db, {
      outDir,
      lock,
      transit: null,
      parcels: four,
      projectsPath: PROJECTS
    });
    const d = r.data!;
    const choice = r.choice!;
    const cells = d.types * CAR_LEVELS;
    const out = new Float64Array(CAR_LEVELS);
    let gap = 0;
    for (let z = 0; z < 4; z++) {
      const lv = [0, 0, 0, 0];
      const pred = [0, 0, 0, 0];
      let n = 0;
      for (let i = 0; i < cells; i++) n += d.households[z * cells + i];
      expect(n).toBe(900);
      for (let t = 0; t < d.types; t++) {
        let nt = 0;
        for (let k = 0; k < CAR_LEVELS; k++) {
          nt += d.households[z * cells + t * CAR_LEVELS + k];
          lv[k] += d.households[z * cells + t * CAR_LEVELS + k];
        }
        if (nt === 0) continue;
        carShares(choice as unknown as CarModel, d, z, t, densityOf(n, d.areaM2[z]), out);
        for (let k = 0; k < CAR_LEVELS; k++) pred[k] += nt * out[k];
      }
      // Start counts equal the model's at month 0 up to rounding (one household per type).
      for (let k = 0; k < CAR_LEVELS; k++) gap = Math.max(gap, Math.abs(lv[k] - pred[k]));
      // B25044 as published has no 3+ renter in zones 1 and 2; the start keeps 3+ households.
      expect(lv[3]).toBeGreaterThan(0);
    }
    expect(gap).toBeLessThanOrEqual(2);
    expect(r.report.join('\n')).toContain('raked to share*');
    db.close();
  });

  it('fails when src_bg_geom lacks the latest release vintage, and writes nothing', async () => {
    const db = await censusDb({ bgVintage: 2010, occupied: 9 });
    const outDir = mkdtempSync(join(tmpdir(), 'sfh-cars-'));
    await expect(
      carsStep(db, { outDir, lock, transit: null, parcels, projectsPath: PROJECTS })
    ).rejects.toThrow(/no 2020 block groups in src_bg_geom for ACS 2024/);
    expect(readdirSync(outDir)).toEqual([]);
    db.close();
  });

  it('fails on 0 households while the zones hold homes', async () => {
    const db = await censusDb({ bgVintage: 2020, occupied: 0 });
    const outDir = mkdtempSync(join(tmpdir(), 'sfh-cars-'));
    await expect(
      carsStep(db, { outDir, lock, transit: null, parcels, projectsPath: PROJECTS })
    ).rejects.toThrow(/0 households on 10 homes in 1 zones/);
    expect(readdirSync(outDir)).toEqual([]);
    db.close();
  });

  it('writes the files when the census places households', async () => {
    const db = await censusDb({ bgVintage: 2020, occupied: 9 });
    const outDir = mkdtempSync(join(tmpdir(), 'sfh-cars-'));
    // 100 homes: enough households that every car level holds some (the zone fit needs each).
    const hundred = { ...parcels, existingUnits: Uint16Array.from([100]) } as ScenarioParcels;
    const r = await carsStep(db, {
      outDir,
      lock,
      transit: null,
      parcels: hundred,
      projectsPath: PROJECTS
    });
    expect(r.counts['cars.households']).toBe(90);
    expect(existsSync(join(outDir, 'scenarios/fzp/cars.bin'))).toBe(true);
    // The choice is fitted (constants only on this data), the model is complete and the report
    // has its sections.
    expect(r.choice?.choice.asc).toHaveLength(3);
    expect(r.data?.constant).toHaveLength(3);
    const m = r.model!;
    expect(m.choice).toBe(r.choice?.choice);
    expect(m.refreshMonths).toBe(12);
    // Every household is of one renter type t; two of four (weights 10 each) moved in within the
    // year. Under 30 records, t takes the renters' rate: 50% a year.
    const t = m.newHomes.mix.market.indexOf(1);
    expect(t % 2).toBe(1);
    expect(m.moves.perMonth[t]).toBeCloseTo(1 - Math.exp(Math.log(0.5) / 12), 12);
    expect(Object.keys(m.moves)).toEqual(['perMonth', 'provenance']);
    expect(m.newHomes.mix.veryLow[t]).toBe(1);
    // The mini projects.json has no affordable completion by tier: the PUMS fallback, warned.
    expect(m.newHomes.affordableTiers).toEqual({ veryLow: 1, low: 0, moderate: 0 });
    expect(r.warnings.join(' ')).toMatch(/sum to 0/);
    // The live parking.json in the prototypes' 2026 dollars (cost index, then SF CPI-U with 2025
    // standing in for 2026): below grade and podium priced, no surface.
    expect(m.parking.dollarsYear).toBe(2026);
    expect(m.parking.costPerSpace).toEqual({ surface: null, podium: 48_756, belowGrade: 120_083 });
    expect(r.report).toContain('### Choice model');
    expect(r.report).toContain('### Moves');
    expect(r.report).toContain('### Parking in new buildings');
    // calibration.json's validator takes the step's model as `cars`, its income edges as fitted.
    expect(m.bands.income).toEqual([0, 20000, 45000, 50000]);
    const cal = JSON.parse(readFileSync(join(dirname(PROJECTS), 'calibration.json'), 'utf8'));
    expect(parseCalibration(JSON.parse(JSON.stringify({ ...cal, cars: m }))).cars).toEqual(m);
    expect(r.report.join('\n')).toContain('DMV: no registrations in the lock');
    db.close();
  });
});
