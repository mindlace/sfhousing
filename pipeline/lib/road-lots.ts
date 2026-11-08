// Road-like lots: City Lands names that mark a lot as street, ramp or other right of way, and the
// hand-kept override file that corrects the name rule either way. A listed word matches a whole
// word only, case-insensitively, on the upper-cased name.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ParcelId } from '../../src/lib/data/parcel';

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
