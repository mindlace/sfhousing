// The freeway-land catalog (lesscars v1.1 spec "Freeway land"): vacant or public parcels under
// or fronting a freeway, curated per segment. While its freeway stands such a parcel is
// unbuildable in every simulator run (`scenarioEligible(rec, units, true)`); the highway
// truncation that removes the segment (`removedBy`) frees it. The curated list is the source of
// truth: candidates are only proposed, and an excluded parcel carries its reason.
import { existsSync, readFileSync } from 'node:fs';
import type { ParcelId } from '../../../src/lib/data/parcel';

export interface FreewaySegment {
  /** e.g. 'us101-james-lick'. */
  id: string;
  /** 'US-101' | 'I-80' | 'I-280' (free text; the count key lower-cases it). */
  freeway: string;
  label: string;
  /** The basemap `ref` token, e.g. 'US 101'. */
  ref: string | null;
  /** src_streets FREEWAYS-layer CNNs of the segment. */
  cnn: string[];
  /** The highway-truncation that removes it; null for a freeway that stays. */
  removedBy: string | null;
  /** 'hand': every parcel checked by hand; 'rule': candidates accepted after a spot check. */
  curated: 'hand' | 'rule';
  /** Sorted, unique. */
  parcels: ParcelId[];
  excluded: { parcel: ParcelId; reason: string }[];
}

export interface FreewayLandFile {
  schema: 1;
  segments: FreewaySegment[];
}

export class FreewayLandFormatError extends Error {
  name = 'FreewayLandFormatError';
}

const fail = (path: string, message: string): never => {
  throw new FreewayLandFormatError(`freeway-land: ${path}: ${message}`);
};

function record(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(`${path}.${k}`, 'unknown key');
  for (const k of keys) if (!(k in r)) fail(`${path}.${k}`, 'missing');
  return r;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v as unknown[];
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') fail(path, 'expected a non-empty string');
  return v as string;
}

const strOrNull = (v: unknown, path: string): string | null => (v === null ? null : str(v, path));

function strings(v: unknown, path: string): string[] {
  return array(v, path).map((x, i) => str(x, `${path}.${i}`));
}

const SEGMENT_KEYS = [
  'id',
  'freeway',
  'label',
  'ref',
  'cnn',
  'removedBy',
  'curated',
  'parcels',
  'excluded'
] as const;

function parseSegment(v: unknown, path: string): FreewaySegment {
  const r = record(v, path, SEGMENT_KEYS);
  const curated = r.curated;
  if (curated !== 'hand' && curated !== 'rule')
    fail(`${path}.curated`, "expected 'hand' or 'rule'");
  const parcels = strings(r.parcels, `${path}.parcels`);
  for (let k = 1; k < parcels.length; k++) {
    if (!(parcels[k - 1] < parcels[k])) fail(`${path}.parcels`, 'expected sorted, unique ids');
  }
  const excluded = array(r.excluded, `${path}.excluded`).map((x, k) => {
    const e = record(x, `${path}.excluded.${k}`, ['parcel', 'reason']);
    return {
      parcel: str(e.parcel, `${path}.excluded.${k}.parcel`),
      reason: str(e.reason, `${path}.excluded.${k}.reason`)
    };
  });
  return {
    id: str(r.id, `${path}.id`),
    freeway: str(r.freeway, `${path}.freeway`),
    label: str(r.label, `${path}.label`),
    ref: strOrNull(r.ref, `${path}.ref`),
    cnn: strings(r.cnn, `${path}.cnn`),
    removedBy: strOrNull(r.removedBy, `${path}.removedBy`),
    curated: curated as 'hand' | 'rule',
    parcels,
    excluded
  };
}

/** Throws naming the first bad field; a parcel in two segments, or both listed and excluded, fails. */
export function parseFreewayLand(json: unknown): FreewayLandFile {
  const r = record(json, '(root)', ['schema', 'segments']);
  if (r.schema !== 1) fail('schema', 'expected 1');
  const segments = array(r.segments, 'segments').map((s, i) => parseSegment(s, `segments.${i}`));
  const ids = new Set<string>();
  /** Parcel → the segment listing it. */
  const listed = new Map<ParcelId, string>();
  segments.forEach((s, i) => {
    if (ids.has(s.id)) fail(`segments.${i}.id`, `duplicate segment id ${s.id}`);
    ids.add(s.id);
    for (const p of s.parcels) {
      const other = listed.get(p);
      if (other !== undefined)
        fail(`segments.${i}.parcels`, `parcel ${p} is listed in two segments (${other}, ${s.id})`);
      listed.set(p, s.id);
    }
  });
  // An exclusion anywhere in the catalog contradicts a listing anywhere in it.
  segments.forEach((s, i) => {
    s.excluded.forEach((e, k) => {
      const by = listed.get(e.parcel);
      if (by !== undefined)
        fail(
          `segments.${i}.excluded.${k}.parcel`,
          `parcel ${e.parcel} is listed in ${by} and excluded`
        );
    });
  });
  return { schema: 1, segments };
}

/** The parsed catalog at `path`; null when the file does not exist. */
export function readFreewayLand(path: string): FreewayLandFile | null {
  if (!existsSync(path)) return null;
  return parseFreewayLand(JSON.parse(readFileSync(path, 'utf8')));
}

/** Every catalog parcel; empty when the file does not exist. */
export function readFreewayLandSet(path: string): ReadonlySet<ParcelId> {
  return freewayLandSet(readFreewayLand(path));
}

/** Every parcel of a parsed catalog (none for null). */
export function freewayLandSet(f: FreewayLandFile | null | undefined): ReadonlySet<ParcelId> {
  return new Set(f?.segments.flatMap((s) => s.parcels) ?? []);
}
