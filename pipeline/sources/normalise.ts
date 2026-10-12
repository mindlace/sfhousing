import fs from 'node:fs';
import path from 'node:path';
import type { Duck } from '../lib/duck';
import { rawPath, type Lock } from '../lib/lock';

export type SourceId =
  | 'datasf-parcels'
  | 'datasf-landuse-2023'
  | 'datasf-footprints'
  | 'datasf-neighborhoods'
  | 'overture-buildings';

export const SOURCE_IDS: SourceId[] = [
  'datasf-parcels',
  'datasf-landuse-2023',
  'datasf-footprints',
  'datasf-neighborhoods',
  'overture-buildings'
];

/** Normalised parquet basename -> src_ table. */
const TABLES: Record<SourceId, string> = {
  'datasf-parcels': 'src_parcels',
  'datasf-landuse-2023': 'src_landuse',
  'datasf-footprints': 'src_footprints',
  'datasf-neighborhoods': 'src_neighborhoods',
  'overture-buildings': 'src_overture'
};

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** UNION ALL BY NAME over every GeoJSON page (SODA lower-cases column names). */
function readPages(files: string[]): string {
  return files.map((f) => `SELECT * FROM ST_Read(${q(f)})`).join('\nUNION ALL BY NAME\n');
}

/** Column absent from every page of a source -> NULL, so a sparse fixture still normalises. */
async function columnsOf(db: Duck, rel: string): Promise<Set<string>> {
  const rows = await db.all<{ column_name: string }>(`DESCRIBE SELECT * FROM (${rel})`);
  return new Set(rows.map((r) => r.column_name));
}

function sel(cols: Set<string>, name: string, type: string): string {
  return cols.has(name) ? `TRY_CAST(${name} AS ${type}) AS ${name}` : `NULL::${type} AS ${name}`;
}

async function buildSelect(
  db: Duck,
  id: SourceId,
  rawFiles: string[],
  parquet: boolean
): Promise<string> {
  if (id === 'overture-buildings' && parquet) {
    // Live input is already in the src_overture schema (written by the fetch step).
    const list = rawFiles.map(q).join(', ');
    return `SELECT id::VARCHAR AS id, height::DOUBLE AS height, num_floors::INTEGER AS num_floors,
      min_height::DOUBLE AS min_height, is_underground::BOOLEAN AS is_underground,
      datasets::VARCHAR[] AS datasets, geom::GEOMETRY AS geom
      FROM read_parquet([${list}]) ORDER BY id`;
  }
  const pages = readPages(rawFiles);
  const cols = await columnsOf(db, pages);
  const p = `(${pages})`;
  switch (id) {
    case 'datasf-parcels':
      return `SELECT ${sel(cols, 'mapblklot', 'VARCHAR')}, ${sel(cols, 'blklot', 'VARCHAR')},
        ${cols.has('active') ? "CAST(active AS VARCHAR) IN ('true','1')" : 'NULL::BOOLEAN'} AS active,
        ${sel(cols, 'analysis_neighborhood', 'VARCHAR')}, geom
        FROM ${p} ORDER BY mapblklot, blklot`;
    case 'datasf-landuse-2023':
      return `SELECT ${sel(cols, 'mapblklot', 'VARCHAR')}, ${sel(cols, 'landuse', 'VARCHAR')},
        ${cols.has('resunits') ? 'CAST(TRY_CAST(resunits AS DOUBLE) AS INTEGER)' : 'NULL::INTEGER'} AS resunits,
        ${sel(cols, 'res', 'DOUBLE')}, ${sel(cols, 'totalcomm', 'DOUBLE')}, geom
        FROM ${p} ORDER BY mapblklot, landuse, resunits`;
    case 'datasf-footprints':
      return `SELECT ${sel(cols, 'mblr', 'VARCHAR')}, ${sel(cols, 'sf16_bldgid', 'VARCHAR')},
        ${sel(cols, 'hgt_median_m', 'DOUBLE')}, geom
        FROM ${p} ORDER BY mblr, sf16_bldgid`;
    case 'datasf-neighborhoods':
      return `SELECT ${sel(cols, 'nhood', 'VARCHAR')}, geom FROM ${p} ORDER BY nhood`;
    case 'overture-buildings':
      return `SELECT ${sel(cols, 'id', 'VARCHAR')}, ${sel(cols, 'height', 'DOUBLE')},
        ${cols.has('num_floors') ? 'CAST(TRY_CAST(num_floors AS DOUBLE) AS INTEGER)' : 'NULL::INTEGER'} AS num_floors,
        ${sel(cols, 'min_height', 'DOUBLE')},
        ${cols.has('is_underground') ? "CAST(is_underground AS VARCHAR) IN ('true','1')" : 'NULL::BOOLEAN'} AS is_underground,
        ${cols.has('datasets') ? 'CAST(datasets AS VARCHAR[])' : 'NULL::VARCHAR[]'} AS datasets, geom
        FROM ${p} ORDER BY id`;
  }
}

/**
 * Normalise one source's raw files into `<outParquet>`; returns the row count. `parquet` says
 * the inputs are already in the src_overture schema (the live fetch output); callers derive it
 * from the lock file names, because live raw files on disk are named by sha256 (no extension).
 * Default: every path ends in `.parquet`.
 */
export async function normalise(
  db: Duck,
  id: SourceId,
  rawFiles: string[],
  outParquet: string,
  parquet: boolean = rawFiles.every((f) => f.endsWith('.parquet'))
): Promise<number> {
  const select = await buildSelect(db, id, rawFiles, parquet);
  fs.mkdirSync(path.dirname(outParquet), { recursive: true });
  await db.run(`COPY (${select}) TO ${q(outParquet)} (FORMAT parquet)`);
  const [r] = await db.all<{ n: number }>(`SELECT count(*) n FROM read_parquet(${q(outParquet)})`);
  return r.n;
}

/** CREATE TABLE src_* AS SELECT * FROM read_parquet(<normDir>/<id>.parquet). */
export async function loadNormalised(db: Duck, normDir: string): Promise<void> {
  for (const id of SOURCE_IDS) {
    const file = path.join(normDir, `${id}.parquet`);
    await db.run(`CREATE OR REPLACE TABLE ${TABLES[id]} AS SELECT * FROM read_parquet(${q(file)})`);
  }
}

/** Normalise every source of the lock into `<normDir>/<id>.parquet`; returns row counts by id. */
export async function normaliseAll(
  db: Duck,
  lock: Lock,
  rawDir: string,
  normDir: string,
  opts: { byName?: boolean } = {}
): Promise<Record<SourceId, number>> {
  // Roof entries are binary processing inputs, never parcel/building normalisation sources.
  const tabularSources = lock.sources.filter(
    (s) => s.id !== 'roof-lidar' && s.id !== 'roof-aerial'
  );
  const rows = {} as Record<SourceId, number>;
  for (const id of SOURCE_IDS) {
    const entry = tabularSources.find((s) => s.id === id);
    if (!entry) throw new Error(`lock has no entry for ${id}`);
    const files = entry.files.map((f) => path.resolve(rawPath(rawDir, f, opts.byName)));
    const parquet = entry.files.every((f) => f.name.endsWith('.parquet'));
    rows[id] = await normalise(db, id, files, path.join(normDir, `${id}.parquet`), parquet);
  }
  return rows;
}
