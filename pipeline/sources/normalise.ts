import fs from 'node:fs';
import path from 'node:path';
import type { Duck } from '../lib/duck';
import { rawPath, type Lock } from '../lib/lock';
import { DATASF, type DatasfId } from './datasf';
import { normaliseLand } from './land';

export type SourceId =
  | 'datasf-parcels'
  | 'datasf-landuse-2023'
  | 'datasf-footprints'
  | 'datasf-neighborhoods'
  | 'datasf-height-bulk'
  | 'datasf-parcel-attrs'
  | 'datasf-assessor-roll'
  | 'overture-buildings'
  | 'protomaps-basemap';

export const SOURCE_IDS: SourceId[] = [
  'datasf-parcels',
  'datasf-landuse-2023',
  'datasf-footprints',
  'datasf-neighborhoods',
  'datasf-height-bulk',
  'datasf-parcel-attrs',
  'datasf-assessor-roll',
  'overture-buildings',
  'protomaps-basemap'
];

/** Normalised parquet basename -> src_ table. */
const TABLES: Record<SourceId, string> = {
  'datasf-parcels': 'src_parcels',
  'datasf-landuse-2023': 'src_landuse',
  'datasf-footprints': 'src_footprints',
  'datasf-neighborhoods': 'src_neighborhoods',
  'datasf-height-bulk': 'src_height_bulk',
  'datasf-parcel-attrs': 'src_parcel_attrs',
  'datasf-assessor-roll': 'src_roll',
  'overture-buildings': 'src_overture',
  'protomaps-basemap': 'src_land'
};

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** UNION ALL BY NAME over every GeoJSON page (SODA lower-cases column names). */
function readPages(files: string[]): string {
  return files.map((f) => `SELECT * FROM ST_Read(${q(f)})`).join('\nUNION ALL BY NAME\n');
}

/**
 * Every CSV page as text (spec §4.1: `read_csv(all_varchar=true)`, then `TRY_CAST`). Options are
 * explicit because live raw files are named by sha256, with no extension to sniff from.
 */
function readCsvPages(files: string[]): string {
  return `SELECT * FROM read_csv([${files.map(q).join(', ')}], header = true, all_varchar = true,
    union_by_name = true, delim = ',', quote = '"', escape = '"')`;
}

const isCsv = (id: SourceId) => id in DATASF && DATASF[id as DatasfId].format === 'csv';

/** Text column -> trimmed text, '' -> NULL; `upper` also upper-cases (parcel ids). */
function txt(cols: Set<string>, name: string, upper = false): string {
  if (!cols.has(name)) return `NULL::VARCHAR AS ${name}`;
  const t = upper ? `upper(trim(${name}))` : `trim(${name})`;
  return `NULLIF(${t}, '') AS ${name}`;
}

/** Numeric text (SODA writes `"3.0"`) through DOUBLE to INTEGER. */
function int(cols: Set<string>, name: string, alias = name): string {
  return cols.has(name)
    ? `TRY_CAST(TRY_CAST(${name} AS DOUBLE) AS INTEGER) AS ${alias}`
    : `NULL::INTEGER AS ${alias}`;
}

/** SODA floating timestamp (`2009-10-14T00:00:00.000`) -> DATE. */
function date(cols: Set<string>, name: string): string {
  return cols.has(name)
    ? `TRY_CAST(TRY_CAST(${name} AS TIMESTAMP) AS DATE) AS ${name}`
    : `NULL::DATE AS ${name}`;
}

/**
 * `cast_flags` bits of src_roll and src_parcel_attrs: the fields whose TRY_CAST rewrote the raw
 * text of that row (scenario-data spec §4.1 "Normalise no longer rewrites any value", §4.12).
 * Each bit is one registered T14 rule, tallied in 80_scenario.sql: `int()` turns non-numeric
 * text into NULL and rounds a fraction to the nearest integer; `sel(…, 'DOUBLE')` turns
 * non-numeric text into NULL; `date()` turns text that is no timestamp into NULL and drops a time
 * of day. Blank text is a source NULL, not a rewrite. 80_scenario.sql uses these literal bits.
 */
export const ROLL_CAST_BITS = {
  closed_roll_year: 1,
  year_property_built: 2,
  number_of_stories: 4,
  number_of_units: 8,
  property_area: 16,
  assessed_land_value: 32,
  assessed_improvement_value: 64
} as const;
export const ATTRS_CAST_BITS = {
  centroid_latitude: 1,
  centroid_longitude: 2,
  date_rec_add: 4,
  date_rec_drop: 8
} as const;

const present = (name: string) => `coalesce(trim(${name}), '') <> ''`;
/** True when `int()` rewrites the raw text: NULL from non-numeric text, or a rounded fraction. */
function intRewritten(name: string): string {
  const d = `TRY_CAST(${name} AS DOUBLE)`;
  return `${present(name)} AND (TRY_CAST(${d} AS INTEGER) IS NULL OR ${d} <> round(${d}))`;
}
/** True when `sel(…, 'DOUBLE')` turns the raw text into NULL. */
const doubleRewritten = (name: string) =>
  `${present(name)} AND TRY_CAST(${name} AS DOUBLE) IS NULL`;
/** True when `date()` turns the raw text into NULL or drops a time of day. */
function dateRewritten(name: string): string {
  const t = `TRY_CAST(${name} AS TIMESTAMP)`;
  return `${present(name)} AND (${t} IS NULL OR ${t} <> CAST(${t} AS DATE))`;
}

/** `cast_flags`: the sum of the bits whose field (when the source has it) was rewritten. */
function castFlags(
  cols: Set<string>,
  fields: [string, number, (name: string) => string][]
): string {
  const terms = fields
    .filter(([name]) => cols.has(name))
    .map(([name, bit, rewritten]) => `CASE WHEN ${rewritten(name)} THEN ${bit} ELSE 0 END`);
  return `(${terms.length ? terms.join(' + ') : '0'})::UTINYINT AS cast_flags`;
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
  if (id === 'protomaps-basemap') throw new Error('protomaps-basemap is decoded by normaliseLand');
  const pages = isCsv(id) ? readCsvPages(rawFiles) : readPages(rawFiles);
  const cols = await columnsOf(db, pages);
  const p = `(${pages})`;
  switch (id) {
    case 'datasf-height-bulk':
      // Height strings stay verbatim: parseHeightDistrict (spec §4.2) normalises them.
      return `SELECT ${sel(cols, 'height', 'VARCHAR')}, ${sel(cols, 'gen_hght', 'VARCHAR')}, geom
        FROM ${p} ORDER BY height, gen_hght, ST_AsHEXWKB(geom)`;
    case 'datasf-parcel-attrs': {
      // `active` other than true/1/false/0 (or blank) is NULL; 80_scenario.sql reads NULL as
      // retired and counts it (sd.attrs.active-unknown).
      const active = cols.has('active')
        ? `CASE lower(trim(active)) WHEN 'true' THEN true WHEN '1' THEN true
             WHEN 'false' THEN false WHEN '0' THEN false END`
        : 'NULL::BOOLEAN';
      const b = ATTRS_CAST_BITS;
      return `SELECT ${txt(cols, 'mapblklot', true)}, ${txt(cols, 'blklot', true)},
        ${active} AS active,
        ${txt(cols, 'zoning_code')}, ${date(cols, 'date_rec_add')}, ${date(cols, 'date_rec_drop')},
        ${sel(cols, 'centroid_latitude', 'DOUBLE')}, ${sel(cols, 'centroid_longitude', 'DOUBLE')},
        ${castFlags(cols, [
          ['centroid_latitude', b.centroid_latitude, doubleRewritten],
          ['centroid_longitude', b.centroid_longitude, doubleRewritten],
          ['date_rec_add', b.date_rec_add, dateRewritten],
          ['date_rec_drop', b.date_rec_drop, dateRewritten]
        ])}
        FROM ${p} ORDER BY ALL`;
    }
    case 'datasf-assessor-roll': {
      // Spec §4.1: normalise rewrites no value. A year built outside [1850, roll year] (SODA has
      // `"0"`) is kept here; the registered rule sd.roll.year-built-range nulls it in
      // 80_scenario.sql, where its firings are counted. The casts' own rewrites are flagged in
      // cast_flags and counted there too (the sd.roll.*-cast rules).
      const b = ROLL_CAST_BITS;
      return `SELECT closed_roll_year, parcel_number, use_code, property_class_code,
        year_property_built,
        number_of_stories, number_of_units, property_area, assessed_land_value,
        assessed_improvement_value, status_code, cast_flags
        FROM (SELECT ${int(cols, 'closed_roll_year')}, ${txt(cols, 'parcel_number', true)},
          ${txt(cols, 'use_code')}, ${txt(cols, 'property_class_code')},
          ${int(cols, 'year_property_built')},
          ${int(cols, 'number_of_stories')}, ${int(cols, 'number_of_units')},
          ${sel(cols, 'property_area', 'DOUBLE')}, ${sel(cols, 'assessed_land_value', 'DOUBLE')},
          ${sel(cols, 'assessed_improvement_value', 'DOUBLE')}, ${txt(cols, 'status_code')},
          ${castFlags(cols, [
            ['closed_roll_year', b.closed_roll_year, intRewritten],
            ['year_property_built', b.year_property_built, intRewritten],
            ['number_of_stories', b.number_of_stories, intRewritten],
            ['number_of_units', b.number_of_units, intRewritten],
            ['property_area', b.property_area, doubleRewritten],
            ['assessed_land_value', b.assessed_land_value, doubleRewritten],
            ['assessed_improvement_value', b.assessed_improvement_value, doubleRewritten]
          ])}
          FROM ${p})
        ORDER BY ALL`;
    }
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
  if (id === 'protomaps-basemap') return normaliseLand(db, rawFiles[0], outParquet);
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
  const rows = {} as Record<SourceId, number>;
  for (const id of SOURCE_IDS) {
    const entry = lock.sources.find((s) => s.id === id);
    if (!entry) throw new Error(`lock has no entry for ${id}`);
    const files = entry.files.map((f) => path.resolve(rawPath(rawDir, f, opts.byName)));
    const parquet = entry.files.every((f) => f.name.endsWith('.parquet'));
    rows[id] = await normalise(db, id, files, path.join(normDir, `${id}.parquet`), parquet);
  }
  return rows;
}
