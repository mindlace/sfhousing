import path from 'node:path';
import { openDuck, runSqlFile, type Duck } from '../lib/duck';
import { createQualityTables } from '../lib/quality';
import type { LandLayer } from '../sources/land';

/** [x0, y0, x1, y1] in local metres from O = (-122.4195, 37.76) in EPSG:7131, as in the mini fixture. */
export type Rect = [x0: number, y0: number, x1: number, y1: number];

export interface LandInput {
  lots: { id: string; rect: Rect }[];
  /** One feature per entry: `rect` is its polygon, `tile` the z15 tile it was read from. */
  land: { layer: LandLayer; tile: Rect; rect: Rect }[];
  buildings?: Rect[];
  /** Tiles that were read and hold no land feature (all water), besides those of `land`. */
  waterTiles?: Rect[];
}

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

/**
 * A database holding just what 45_land.sql reads (parcels as 10_parcels.sql writes them, with labels
 * from sfh_label; buildings; src_land and src_land_tiles; report_counts; the quality tables), after 05_macros.sql and
 * 45_land.sql have run. O is snapped to the 1 cm grid of the land features (ST_ReducePrecision), so
 * a rect edge and a land edge at the same local coordinate coincide.
 */
export async function landDb(o: LandInput): Promise<Duck> {
  const db = await openDuck();
  const [{ ox, oy }] = await db.all<{ ox: number; oy: number }>(
    `SELECT round(ST_X(p), 2) ox, round(ST_Y(p), 2) oy FROM (
       SELECT ST_Transform(ST_Point(-122.4195, 37.76), 'EPSG:4326', 'EPSG:7131', always_xy := true) p)`
  );
  const env = ([x0, y0, x1, y1]: Rect) =>
    `ST_MakeEnvelope(${ox + x0}, ${oy + y0}, ${ox + x1}, ${oy + y1})`;
  const to4326 = (r: Rect) =>
    `ST_Transform(${env(r)}, 'EPSG:7131', 'EPSG:4326', always_xy := true)`;
  const values = (rows: string[], empty: string) =>
    rows.length ? `VALUES ${rows.join(', ')}` : `SELECT ${empty} WHERE false`;

  await db.run('CREATE TABLE report_counts(key VARCHAR, value DOUBLE)');
  await createQualityTables(db);
  await runSqlFile(db, path.join(SQL_DIR, '05_macros.sql'));

  await db.run(
    `CREATE TEMP TABLE h_lots AS SELECT * FROM (${values(
      o.lots.map((l) => `('${l.id}', ${env(l.rect)})`),
      `NULL::VARCHAR, NULL::GEOMETRY`
    )}) t(id, geom)`
  );
  await db.run(
    `CREATE TABLE parcels AS
     SELECT l.id, l.geom,
            ST_Transform(l.geom, 'EPSG:7131', 'EPSG:4326', always_xy := true) AS geom4326,
            round(ST_X(ST_Transform(b.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7) AS label_lng,
            round(ST_Y(ST_Transform(b.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7) AS label_lat,
            ST_X(b.lp) AS x0, ST_Y(b.lp) AS y0, b.label_fallback::INTEGER AS label_fallback,
            'N' AS neighborhood, FALSE AS nb_fallback,
            ST_NGeometries(l.geom)::INTEGER AS n_parts, 0::INTEGER AS n_holes
     FROM h_lots l JOIN sfh_label('h_lots') b USING (id)
     ORDER BY l.id;
     ALTER TABLE parcels ADD PRIMARY KEY (id);`
  );
  await db.run(
    `CREATE TABLE buildings AS SELECT * FROM (${values(
      (o.buildings ?? []).map(
        (r, i) => `('b${String(i).padStart(2, '0')}', ${env(r)}, 7.0, 0.0, 3, ['osm'])`
      ),
      `NULL::VARCHAR, NULL::GEOMETRY, NULL::DOUBLE, NULL::DOUBLE, NULL::INTEGER, NULL::VARCHAR[]`
    )}) t(bid, geom, height_m, base_m, hs, datasets)`
  );
  await db.run(
    `CREATE TABLE src_land(layer VARCHAR, z INTEGER, x INTEGER, y INTEGER, fid INTEGER,
       w DOUBLE, s DOUBLE, e DOUBLE, n DOUBLE, geojson VARCHAR)`
  );
  await db.run(
    `CREATE TABLE src_land_tiles(z INTEGER, x INTEGER, y INTEGER, w DOUBLE, s DOUBLE, e DOUBLE,
       n DOUBLE)`
  );
  // Tile bounds: the lon of the midpoints of the tile's west and east edges, the lat of the
  // midpoints of its south and north edges. A real tile's edges are a meridian and a parallel, a
  // little skewed against the 7131 grid; through the midpoints the skew is half that of the
  // rect's 4326 bounding box (which overshoots a 100 m tile edge by about 2 cm).
  const mid = (x: number, y: number) =>
    `ST_Transform(ST_Point(${ox + x}, ${oy + y}), 'EPSG:7131', 'EPSG:4326', always_xy := true)`;
  const bounds = ([x0, y0, x1, y1]: Rect) => {
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    return `ST_X(${mid(x0, cy)}), ST_Y(${mid(cx, y0)}), ST_X(${mid(x1, cy)}), ST_Y(${mid(cx, y1)})`;
  };
  for (const [i, f] of o.land.entries()) {
    await db.run(
      `INSERT INTO src_land
       SELECT '${f.layer}', 15, ${i}, ${i}, 0, ${bounds(f.tile)}, ST_AsGeoJSON(${to4326(f.rect)})`
    );
    await db.run(`INSERT INTO src_land_tiles SELECT 15, ${i}, ${i}, ${bounds(f.tile)}`);
  }
  // Water-only tiles take x = y = 1000 + index, clear of the land features' tile indices.
  for (const [i, t] of (o.waterTiles ?? []).entries()) {
    await db.run(`INSERT INTO src_land_tiles SELECT 15, ${1000 + i}, ${1000 + i}, ${bounds(t)}`);
  }

  await runSqlFile(db, path.join(SQL_DIR, '45_land.sql'));
  return db;
}

/** report_counts as an object. */
export async function landCounts(db: Duck): Promise<Record<string, number>> {
  const rows = await db.all<{ key: string; value: number }>('SELECT key, value FROM report_counts');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
