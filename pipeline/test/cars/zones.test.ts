import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gridLngLat, type AccessGrid } from '../../../src/lib/transit/grid';
import { project } from '../../../src/lib/plan/geometry';
import { zoneAccess } from '../../lib/cars/access';
import { assignZones, zoneFeatures } from '../../lib/cars/zones';
import { openDuck, type Duck } from '../../lib/duck';
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { carsStep } from '../../steps/cars';

/** A lng/lat box as WKT. */
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
