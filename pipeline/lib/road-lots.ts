// Road-like lots: City Lands names that mark a lot as street, ramp or other right of way, and the
// hand-kept override file that corrects the name rule either way. A listed word matches a whole
// word only, case-insensitively, on the upper-cased name.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ParcelId } from '../../src/lib/data/parcel';
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
    if (block.length !== 4) fail(`${at}.block`, 'expected 4 characters');
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
 * (stale), a road row naming no parcel, a road row on a catalog parcel, a road row the raw rule
 * already flags.
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
              WHEN NOT EXISTS (SELECT 1 FROM parcels p WHERE left(p.id, 4) = k.block)
                THEN 'keep block ' || k.block || ' names no parcel'
              WHEN NOT EXISTS (SELECT 1 FROM raw WHERE left(raw.id, 4) = k.block)
                THEN 'keep block ' || k.block || ': the rule does not flag any lot of it (stale)'
            END
     FROM rl_keep k WHERE k.block IS NOT NULL
     UNION ALL
     SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM parcels p WHERE p.id = r.parcel)
                THEN 'road parcel ' || r.parcel || ' names no parcel'
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
