// The render-only building boxes of `build` (plan Decisions: build only composes, clips and
// tiles). Loads the locked building-boxes artifact, composes render_boxes (today's box for a
// building the artifact has no row for) and clips it to parcels with 76_render_boxes.sql, beside
// the model's pieces, which never move.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSqlFile, type Duck } from '../lib/duck';
import { boxesCounts, outsideFootprint } from '../lib/lidar/artifact';

/** A copy of the artifact's roofs.parquet in the derived cache, for review. */
export const BUILDING_ROOFS_PARQUET = 'building-roofs.parquet';
/** render_pieces in the derived cache (GeoParquet, EPSG:7131), for review. */
export const RENDER_PIECES_PARQUET = 'render-pieces.parquet';

const RENDER_SQL = resolve(import.meta.dirname, '../sql/76_render_boxes.sql');
const SRCS = ['box', 'base', 'front', 'step', 'part'] as const;

const q = (s: string): string => `'${s.replaceAll("'", "''")}'`;

async function count(db: Duck, sql: string): Promise<number> {
  const [r] = await db.all<{ n: number }>(sql);
  return Number(r.n);
}

/**
 * With the artifact's two parquet files: load bx_boxes (geom through ST_GeomFromWKB) and bx_roofs,
 * run 76_render_boxes.sql (render_boxes, render_pieces, render_export), write
 * BUILDING_ROOFS_PARQUET and RENDER_PIECES_PARQUET into derivedDir and return the counts:
 * boxesCounts, with `boxes.src.*` and `boxes.buildings.box` taken from render_boxes (F16: the
 * build's composition decides the single boxes), plus `boxes.outside_footprint` (non-part boxes
 * outside their footprint; must be 0), `boxes.missing_buildings` (buildings without a render box),
 * `boxes.artifact_unknown_bids` (artifact bids not in buildings, ignored), `render.pieces` and
 * `render.outside_parcels`. Without the artifact (files null) nothing is created: written false.
 */
export async function writeRenderBoxes(a: {
  db: Duck;
  files: { boxes: string; roofs: string } | null;
  derivedDir: string;
}): Promise<{ written: boolean; counts: Record<string, number> }> {
  const { db, files } = a;
  if (!files) return { written: false, counts: {} };
  await db.run(`
    CREATE OR REPLACE TABLE bx_boxes AS
    SELECT bid, k, src, base_m, height_m, ST_GeomFromWKB(geom) AS geom
    FROM read_parquet(${q(files.boxes)})
    ORDER BY bid, k`);
  await db.run(
    `CREATE OR REPLACE TABLE bx_roofs AS SELECT * FROM read_parquet(${q(files.roofs)}) ORDER BY bid`
  );
  await runSqlFile(db, RENDER_SQL);

  const counts = await boxesCounts(db);
  for (const s of SRCS)
    counts[`boxes.src.${s}`] = await count(
      db,
      `SELECT count(*) AS n FROM render_boxes WHERE src = '${s}'`
    );
  counts['boxes.buildings.box'] = counts['boxes.src.box'];
  counts['boxes.outside_footprint'] = await outsideFootprint(
    db,
    'SELECT bid, src, geom FROM render_boxes'
  );
  counts['boxes.missing_buildings'] = await count(
    db,
    'SELECT count(*) AS n FROM buildings WHERE bid NOT IN (SELECT bid FROM render_boxes)'
  );
  counts['boxes.artifact_unknown_bids'] = await count(
    db,
    `SELECT count(*) AS n FROM (SELECT bid FROM bx_boxes UNION SELECT bid FROM bx_roofs)
     WHERE bid NOT IN (SELECT bid FROM buildings)`
  );
  counts['render.pieces'] = await count(db, 'SELECT count(*) AS n FROM render_pieces');
  counts['render.outside_parcels'] = await count(
    db,
    'SELECT count(*) AS n FROM render_pieces WHERE parcel_id IS NULL'
  );

  mkdirSync(a.derivedDir, { recursive: true });
  copyFileSync(files.roofs, join(a.derivedDir, BUILDING_ROOFS_PARQUET));
  await db.run(
    `COPY (SELECT * FROM render_pieces ORDER BY bid, k, parcel_id NULLS LAST)
     TO ${q(join(a.derivedDir, RENDER_PIECES_PARQUET))} (FORMAT parquet, COMPRESSION zstd)`
  );
  return { written: true, counts };
}
