// Car zones: the Census block groups of one vintage (src_bg_geom), and the zone of each lot (its
// label point in the block-group polygon, DuckDB spatial, EPSG:7131).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duck } from '../duck';

/** Block-group polygons are simplified to this tolerance (metres) for car-zones.json. */
export const ZONE_SIMPLIFY_M = 5;
/** car-zones.json coordinates are rounded to this many decimals (about 0.1 m). */
const COORD_DECIMALS = 6;

export interface ZoneAssignment {
  zones: string[];
  areaM2: Float64Array;
  lotZone: Int32Array;
  counts: Record<string, number>;
}

/**
 * Zones are the `vintage` block groups sorted by GEOID; area is TIGER's land area (ALAND). A lot's
 * zone is the block group its label point falls in (lowest zone on a shared edge), -1 for none
 * (counted in `cars.lotsNoZone`).
 */
export async function assignZones(
  db: Duck,
  o: { vintage: number; lngLat: Float64Array }
): Promise<ZoneAssignment> {
  const zrows = await db.all<{ geoid: string; aland: number }>(
    `SELECT geoid, aland FROM src_bg_geom WHERE vintage = ${o.vintage} ORDER BY geoid`
  );
  const zones = zrows.map((r) => r.geoid);
  const areaM2 = Float64Array.from(zrows, (r) => Math.max(0, r.aland ?? 0));
  const n = o.lngLat.length / 2;
  const lotZone = new Int32Array(n).fill(-1);
  const work = mkdtempSync(join(tmpdir(), 'sfh-cars-'));
  try {
    const csv = join(work, 'lots.csv');
    const lines = ['i,lng,lat'];
    for (let i = 0; i < n; i++) lines.push(`${i},${o.lngLat[2 * i]},${o.lngLat[2 * i + 1]}`);
    writeFileSync(csv, lines.join('\n') + '\n');
    await db.run(`CREATE OR REPLACE TEMP TABLE cars_zone AS
      SELECT (row_number() OVER (ORDER BY geoid) - 1)::INTEGER AS z, geom
      FROM src_bg_geom WHERE vintage = ${o.vintage}`);
    await db.run(`CREATE OR REPLACE TEMP TABLE cars_lot AS
      SELECT i, ST_Transform(ST_Point(lng, lat), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS pt
      FROM read_csv('${csv}', header = true, columns = {'i': 'INTEGER', 'lng': 'DOUBLE', 'lat': 'DOUBLE'})`);
    const hits = await db.all<{ i: number; z: number }>(`SELECT l.i, min(c.z) AS z
      FROM cars_lot l JOIN cars_zone c ON ST_Intersects(c.geom, l.pt)
      GROUP BY l.i ORDER BY l.i`);
    for (const h of hits) lotZone[h.i] = h.z;
    await db.run('DROP TABLE cars_lot');
    await db.run('DROP TABLE cars_zone');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  let noZone = 0;
  for (let i = 0; i < n; i++) if (lotZone[i] < 0) noZone++;
  return {
    zones,
    areaM2,
    lotZone,
    counts: { 'cars.zones': zones.length, 'cars.lotsNoZone': noZone }
  };
}

export interface ZoneFeature {
  type: 'Feature';
  properties: { z: number; geoid: string };
  geometry: { type: string; coordinates: unknown } | null;
}
export interface ZoneCollection {
  type: 'FeatureCollection';
  features: ZoneFeature[];
}

const round = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Number(v.toFixed(COORD_DECIMALS)) : v;

/**
 * car-zones.json: one feature per zone in zone order, property `z` the zone index (and the
 * GEOID), the block-group polygon simplified to ZONE_SIMPLIFY_M in lng/lat. An empty polygon
 * becomes a null geometry, so the feature count stays the zone count.
 */
export async function zoneFeatures(db: Duck, vintage: number): Promise<ZoneCollection> {
  const rows = await db.all<{ geoid: string; gj: string | null }>(`SELECT geoid,
      CASE WHEN ST_IsEmpty(s) THEN NULL ELSE ST_AsGeoJSON(
        ST_Transform(s, 'EPSG:7131', 'EPSG:4326', always_xy := true)) END AS gj
    FROM (SELECT geoid, ST_SimplifyPreserveTopology(geom, ${ZONE_SIMPLIFY_M}) AS s
      FROM src_bg_geom WHERE vintage = ${vintage})
    ORDER BY geoid`);
  return {
    type: 'FeatureCollection',
    features: rows.map((r, z) => {
      const g = r.gj ? (JSON.parse(r.gj) as { type: string; coordinates: unknown }) : null;
      return {
        type: 'Feature',
        properties: { z, geoid: r.geoid },
        geometry: g ? { type: g.type, coordinates: round(g.coordinates) } : null
      };
    })
  };
}
