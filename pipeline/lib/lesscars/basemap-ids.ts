// The curated basemap id list (docs/dev/lesscars.md "Basemap ids"): per removal phase, the
// protomaps `roads` feature ids the page hides once the phase's freeway stretch is gone. The ids
// are OSM-derived and stable across tile zooms of one basemap build; the build checks every
// listed id is still in the dataset's basemap.pmtiles (basemapIdsMissing), so a rebuilt basemap
// cannot silently strand the list.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface BasemapIdsFile {
  schema: 1;
  /** sha256 of the protomaps-basemap lock file the ids were read from. */
  source: { sha256: string };
  phases: { project: string; ref: string | null; ids: number[] }[]; // ids sorted, unique
}

/** `lesscars-basemap` candidates mode writes here; the curated list is basemap-ids.json beside it. */
export const BASEMAP_IDS_CANDIDATES_JSON = path.resolve(
  import.meta.dirname,
  '../../enrichment/lesscars/basemap-ids.candidates.json'
);

export class BasemapIdsFormatError extends Error {
  name = 'BasemapIdsFormatError';
}

const fail = (at: string, message: string): never => {
  throw new BasemapIdsFormatError(`basemap-ids: ${at}: ${message}`);
};

function record(v: unknown, at: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(at, 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(`${at}.${k}`, 'unknown key');
  for (const k of keys) if (!(k in r)) fail(`${at}.${k}`, 'missing');
  return r;
}

export function parseBasemapIds(json: unknown): BasemapIdsFile {
  const top = record(json, '$', ['schema', 'source', 'phases']);
  if (top.schema !== 1) fail('$.schema', 'expected 1');
  const source = record(top.source, '$.source', ['sha256']);
  if (typeof source.sha256 !== 'string' || source.sha256 === '')
    fail('$.source.sha256', 'expected a non-empty string');
  if (!Array.isArray(top.phases)) fail('$.phases', 'expected an array');
  const phases = (top.phases as unknown[]).map((p, i) => {
    const at = `$.phases[${i}]`;
    const r = record(p, at, ['project', 'ref', 'ids']);
    if (typeof r.project !== 'string' || r.project === '')
      fail(`${at}.project`, 'expected a string');
    if (r.ref !== null && (typeof r.ref !== 'string' || r.ref === ''))
      fail(`${at}.ref`, 'expected a string or null');
    if (!Array.isArray(r.ids)) fail(`${at}.ids`, 'expected an array');
    const ids = r.ids as unknown[];
    ids.forEach((id, k) => {
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)
        fail(`${at}.ids[${k}]`, 'expected a non-negative safe integer');
      if (k > 0 && (id as number) === (ids[k - 1] as number))
        fail(`${at}.ids[${k}]`, 'ids must be unique');
      if (k > 0 && (id as number) < (ids[k - 1] as number))
        fail(`${at}.ids[${k}]`, 'ids must be sorted ascending');
    });
    return { project: r.project as string, ref: r.ref as string | null, ids: ids as number[] };
  });
  return { schema: 1, source: { sha256: source.sha256 as string }, phases };
}

/** The id list at `path`, or null when the file is absent (the live build until Plan B). */
export function readBasemapIds(file: string): BasemapIdsFile | null {
  if (!existsSync(file)) return null;
  return parseBasemapIds(JSON.parse(readFileSync(file, 'utf8')));
}
