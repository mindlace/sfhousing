// Road-like lots: City Lands names that mark a lot as street, ramp or other right of way, and the
// hand-kept override file that corrects the name rule either way. A listed word matches a whole
// word only, case-insensitively, on the upper-cased name.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParcelId, RoadLikeReason } from '../../src/lib/data/parcel';
import { createTableFromRows, type Duck } from './duck';

export const ROAD_NAME_WORDS: readonly string[] = [
  'RIGHT-OF-WAY',
  // Unhyphenated spelling; live names use both (recon 2026-11-07).
  'RIGHT OF WAY',
  'ROW',
  'R/W',
  // Whole word only: a substring match also hits BROADWAY (recon 2026-11-07).
  'ROADWAY',
  'OVERPASS',
  'MERIDIAN',
  'SLOPE PROTECTION',
  'REMAINDER',
  'PEDESTRIAN BRIDGE',
  'STRIP ALONG',
  'UNDEDICATED',
  'VACATED',
  'STREET AREA',
  'REALIGNMENT',
  'EXCESS PROPERTY',
  'WALKWAY',
  'TRAFFIC ISLAND',
  'FREEWAY',
  'BART TRACKS',
  'MEDIAN',
  'RELINQUISHMENT',
  // Narrowed from CIRCLE, which also names parks and housing sites (recon 2026-11-07).
  // PLAZA is left out: its live matches include parks, civic plazas and a MOHCD housing site.
  'CHAVEZ ST CIRCLE'
];

/** An RE2- and JS-compatible whole-word pattern, matched against the upper-cased name. */
export function roadWordPattern(word: string): string {
  return `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
}

const PATTERNS = ROAD_NAME_WORDS.map((w) => [w, new RegExp(roadWordPattern(w))] as const);

/** Every list word the name contains, in list order. */
export function roadNameWords(name: string | null): string[] {
  if (name === null) return [];
  const up = name.toUpperCase();
  return PATTERNS.filter(([, re]) => re.test(up)).map(([w]) => w);
}

export interface RoadLotsFile {
  keep: ({ parcel: ParcelId; reason: string } | { block: string; reason: string })[];
  road: { parcel: ParcelId; reason: string }[];
}

/** An SF block: 4 digits and an optional capital letter (`0026` and `0026T` are separate blocks). */
export const BLOCK_RE = /^[0-9]{4}[A-Z]?$/;

/** The SQL expression for a parcel id's block (BLOCK_RE without the end anchor). */
export const SQL_BLOCK_OF = (col: string) => `regexp_extract(${col}, '^[0-9]{4}[A-Z]?')`;

export class RoadLotsFormatError extends Error {
  name = 'RoadLotsFormatError';
}

const fail = (at: string, message: string): never => {
  throw new RoadLotsFormatError(`road-lots: ${at}: ${message}`);
};

function row(v: unknown, at: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(at, 'expected an object');
  return v as Record<string, unknown>;
}

function nonBlank(v: unknown, at: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(at, 'expected a non-blank string');
  return v as string;
}

function list(v: unknown, at: string): unknown[] {
  if (!Array.isArray(v)) fail(at, 'expected an array');
  return v as unknown[];
}

function onlyKeys(r: Record<string, unknown>, at: string, keys: readonly string[]): void {
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(`${at}.${k}`, 'unknown key');
}

/** Throws naming the first bad field. */
export function parseRoadLots(json: unknown): RoadLotsFile {
  const root = row(json, '(root)');
  onlyKeys(root, '(root)', ['keep', 'road']);
  const seen = new Set<string>();
  const dup = (key: string, at: string) => {
    if (seen.has(key)) fail(at, `duplicate row ${key}`);
    seen.add(key);
  };
  const keep = list(root.keep, 'keep').map((x, i) => {
    const at = `keep.${i}`;
    const r = row(x, at);
    onlyKeys(r, at, ['parcel', 'block', 'reason']);
    const reason = nonBlank(r.reason, `${at}.reason`);
    const hasParcel = 'parcel' in r;
    const hasBlock = 'block' in r;
    if (hasParcel === hasBlock) fail(at, 'expected exactly one of parcel and block');
    if (hasParcel) {
      const parcel = nonBlank(r.parcel, `${at}.parcel`);
      dup(`keep parcel ${parcel}`, at);
      return { parcel, reason };
    }
    const block = nonBlank(r.block, `${at}.block`);
    if (!BLOCK_RE.test(block))
      fail(`${at}.block`, 'expected 4 digits and an optional capital letter');
    dup(`keep block ${block}`, at);
    return { block, reason };
  });
  const keptParcels = new Set(keep.flatMap((k) => ('parcel' in k ? [k.parcel] : [])));
  const roadSeen = new Set<string>();
  const road = list(root.road, 'road').map((x, i) => {
    const at = `road.${i}`;
    const r = row(x, at);
    onlyKeys(r, at, ['parcel', 'reason']);
    const parcel = nonBlank(r.parcel, `${at}.parcel`);
    const reason = nonBlank(r.reason, `${at}.reason`);
    if (roadSeen.has(parcel)) fail(at, `duplicate row ${parcel}`);
    roadSeen.add(parcel);
    if (keptParcels.has(parcel)) fail(at, `parcel ${parcel} is in both keep and road`);
    return { parcel, reason };
  });
  return { keep, road };
}

/** The parsed override file at `path`; a missing file throws. */
export function readRoadLots(file: string): RoadLotsFile {
  return parseRoadLots(JSON.parse(readFileSync(file, 'utf8')));
}

const PIPELINE_DIR = path.join(import.meta.dirname, '..');

/** The override file: live, and the mini fixture's. */
export const ROAD_LOTS_JSON = {
  live: path.join(PIPELINE_DIR, 'enrichment/road-lots.json'),
  fixture: path.join(PIPELINE_DIR, 'test/fixtures/mini/enrichment/road-lots.json')
};

/**
 * Write the build's inputs to 55_road_lots.sql, replacing any earlier ones: rl_catalog(id) (the
 * freeway-land catalog parcels, never road-like), rl_keep(parcel, block, reason) (one of parcel
 * and block set) and rl_road(parcel, reason).
 */
export async function loadRoadLotInputs(
  db: Duck,
  catalog: ReadonlySet<ParcelId>,
  overrides: RoadLotsFile
): Promise<void> {
  await createTableFromRows(
    db,
    'rl_catalog',
    [['id', 'VARCHAR']],
    [...catalog].sort().map((id) => [id])
  );
  await createTableFromRows(
    db,
    'rl_keep',
    [
      ['parcel', 'VARCHAR'],
      ['block', 'VARCHAR'],
      ['reason', 'VARCHAR']
    ],
    overrides.keep.map((k) =>
      'parcel' in k ? [k.parcel, null, k.reason] : [null, k.block, k.reason]
    )
  );
  await createTableFromRows(
    db,
    'rl_road',
    [
      ['parcel', 'VARCHAR'],
      ['reason', 'VARCHAR']
    ],
    overrides.road.map((r) => [r.parcel, r.reason])
  );
}

/**
 * Rewrite rl_word(word, pattern) from ROAD_NAME_WORDS, and create rl_catalog, rl_keep and rl_road
 * empty when absent, so 55_road_lots.sql runs for a caller that loaded no inputs.
 */
export async function ensureRoadLotInputs(db: Duck): Promise<void> {
  await createTableFromRows(
    db,
    'rl_word',
    [
      ['word', 'VARCHAR'],
      ['pattern', 'VARCHAR']
    ],
    ROAD_NAME_WORDS.map((w) => [w, roadWordPattern(w)])
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS rl_catalog (id VARCHAR);
     CREATE TABLE IF NOT EXISTS rl_keep (parcel VARCHAR, block VARCHAR, reason VARCHAR);
     CREATE TABLE IF NOT EXISTS rl_road (parcel VARCHAR, reason VARCHAR);`
  );
}

/**
 * The override rows the raw rule contradicts, after 55_road_lots.sql has run, one message per
 * row, sorted: a keep row naming no parcel or block, a keep row the raw rule does not flag
 * (stale), a road row naming no parcel, a road row on an underwater lot (already ineligible, and
 * dropped from road_lots), a road row on a catalog parcel, a road row the raw rule already flags.
 */
export async function roadLotProblems(db: Duck): Promise<string[]> {
  const rows = await db.all<{ msg: string }>(
    `WITH raw AS (SELECT id FROM road_lot_eval WHERE raw)
     SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM parcels p WHERE p.id = k.parcel)
                THEN 'keep parcel ' || k.parcel || ' names no parcel'
              WHEN NOT EXISTS (SELECT 1 FROM raw WHERE raw.id = k.parcel)
                THEN 'keep parcel ' || k.parcel || ': the rule does not flag it (stale)'
            END AS msg
     FROM rl_keep k WHERE k.parcel IS NOT NULL
     UNION ALL
     SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM parcels p WHERE ${SQL_BLOCK_OF('p.id')} = k.block)
                THEN 'keep block ' || k.block || ' names no parcel'
              WHEN NOT EXISTS (SELECT 1 FROM raw WHERE ${SQL_BLOCK_OF('raw.id')} = k.block)
                THEN 'keep block ' || k.block || ': the rule does not flag any lot of it (stale)'
            END
     FROM rl_keep k WHERE k.block IS NOT NULL
     UNION ALL
     SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM parcels p WHERE p.id = r.parcel)
                THEN 'road parcel ' || r.parcel || ' names no parcel'
              WHEN EXISTS (SELECT 1 FROM parcels p WHERE p.id = r.parcel AND p.underwater)
                THEN 'road parcel ' || r.parcel || ' is underwater (already ineligible)'
              WHEN EXISTS (SELECT 1 FROM rl_catalog c WHERE c.id = r.parcel)
                THEN 'road parcel ' || r.parcel || ' is freeway-land catalog land'
              WHEN EXISTS (SELECT 1 FROM raw WHERE raw.id = r.parcel)
                THEN 'road parcel ' || r.parcel || ': the rule already flags it'
            END
     FROM rl_road r`
  );
  return rows
    .map((r) => r.msg)
    .filter((m): m is string => m !== null)
    .sort();
}

/** road_lots (55_road_lots.sql) by id, in id order: the reason and the eligibility without it. */
export async function readRoadLotRows(
  db: Duck
): Promise<Map<ParcelId, { reason: RoadLikeReason; eligibleWithout: boolean }>> {
  const rows = await db.all<{ id: string; reason: RoadLikeReason; eligible_without: boolean }>(
    'SELECT id, reason, eligible_without FROM road_lots ORDER BY id'
  );
  return new Map(
    rows.map((r) => [r.id, { reason: r.reason, eligibleWithout: r.eligible_without }])
  );
}

/** The review list's file name in the build's derived directory (never uploaded). */
export const ROAD_LOTS_CSV = 'road-lots.csv';

/**
 * One row of road-lots.csv: a lot the raw rule flags (kept or not), or a `road` row's lot. The
 * build's DuckDB is gone after the build, so the row carries everything the imagery review needs.
 * `reason` is null for a kept lot; the rule columns and the measures are road_lot_eval's (false,
 * 0 or null for a road row's lot outside the evaluated lots). `cover` and `streetShare` are 0
 * where 55_road_lots.sql did not measure them (a zero-area lot; a lot not bare, or with no public
 * street within the band). `netHomes`: the static net capacity the rule takes away (for a kept
 * lot, what it would take away), as `scenario.road_like.net_removed` counts it. `lng`, `lat`: the
 * chunk record's label point.
 */
export interface RoadLotReviewRow {
  id: ParcelId;
  reason: RoadLikeReason | null;
  r7: boolean;
  r1n: boolean;
  r2s: boolean;
  r3: boolean;
  keptBy: string | null;
  listed: boolean;
  landName: string | null;
  department: string | null;
  zoning: string | null;
  rollClass: string | null;
  cover: number;
  micR: number | null;
  streetShare: number;
  nearestStreet: string | null;
  nearestM: number | null;
  areaM2: number;
  netHomes: number;
  lng: number;
  lat: number;
}

/** A review row without the scenario step's `netHomes` and the record's label point. */
export type RoadLotReviewBase = Omit<RoadLotReviewRow, 'netHomes' | 'lng' | 'lat'>;

/**
 * The review list's lots after 55_road_lots.sql, in id order: every lot the raw rule flags and
 * every `road` row's lot (road_lot_eval.listed, or a road_lots row outside the evaluated lots).
 */
export async function readRoadLotReview(db: Duck): Promise<RoadLotReviewBase[]> {
  const rows = await db.all<{
    id: string;
    reason: RoadLikeReason | null;
    r7: boolean | null;
    r1n: boolean | null;
    r2s: boolean | null;
    r3: boolean | null;
    kept_by: string | null;
    listed: boolean | null;
    land_name: string | null;
    department: string | null;
    zoning_code: string | null;
    roll_class: string | null;
    cover: number | null;
    mic_r: number | null;
    street_share: number | null;
    nearest_street: string | null;
    nearest_m: number | null;
    area_m2: number;
  }>(
    `WITH ids AS (
       SELECT id FROM road_lot_eval WHERE raw OR listed
       UNION SELECT id FROM road_lots
     )
     SELECT i.id, r.reason, e.r7, e.r1n, e.r2s, e.r3, e.kept_by,
            coalesce(e.listed, r.reason = 'override') AS listed,
            e.land_name, e.department, e.zoning_code, e.roll_class, e.cover, e.mic_r,
            e.street_share, e.nearest_street, e.nearest_m, ST_Area(p.geom) AS area_m2
     FROM ids i
     JOIN parcels p USING (id)
     LEFT JOIN road_lot_eval e USING (id)
     LEFT JOIN road_lots r USING (id)
     ORDER BY i.id`
  );
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    r7: r.r7 ?? false,
    r1n: r.r1n ?? false,
    r2s: r.r2s ?? false,
    r3: r.r3 ?? false,
    keptBy: r.kept_by,
    listed: r.listed ?? false,
    landName: r.land_name,
    department: r.department,
    zoning: r.zoning_code,
    rollClass: r.roll_class,
    cover: r.cover ?? 0,
    micR: r.mic_r,
    streetShare: r.street_share ?? 0,
    nearestStreet: r.nearest_street,
    nearestM: r.nearest_m,
    areaM2: r.area_m2
  }));
}

const CSV_COLUMNS: readonly (keyof RoadLotReviewRow)[] = [
  'id',
  'reason',
  'r7',
  'r1n',
  'r2s',
  'r3',
  'keptBy',
  'listed',
  'landName',
  'department',
  'zoning',
  'rollClass',
  'cover',
  'micR',
  'streetShare',
  'nearestStreet',
  'nearestM',
  'areaM2',
  'netHomes',
  'lng',
  'lat'
];

/** Decimals per number column: 3, but 6 for the label point (3 decimals is about 100 m). */
const DECIMALS: Partial<Record<keyof RoadLotReviewRow, number>> = { lng: 6, lat: 6 };

function csvCell(v: string | number | boolean | null, decimals: number): string {
  if (v === null) return '';
  if (typeof v === 'number') {
    const f = 10 ** decimals;
    return String(Math.round(v * f) / f);
  }
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Write the review list to `file`: a header row, then the rows by `netHomes` descending, then id.
 * Numbers are rounded to 3 decimals (the label point to 6), null is an empty cell, and a text cell
 * holding a comma, quote or line break is quoted (RFC 4180).
 */
export function writeRoadLotsCsv(file: string, rows: RoadLotReviewRow[]): void {
  const sorted = [...rows].sort(
    (a, b) => b.netHomes - a.netHomes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const lines = [
    CSV_COLUMNS.join(','),
    ...sorted.map((r) => CSV_COLUMNS.map((k) => csvCell(r[k], DECIMALS[k] ?? 3)).join(','))
  ];
  writeFileSync(file, lines.join('\n') + '\n');
}
