// `npm run pipeline -- lesscars-cnns`: resolve the /lesscars corridor selectors
// (pipeline/enrichment/lesscars/corridors.json, a transcription of plan-v1 Appendix A) to CNN
// lists from the locked datasf-streets raw files, and write corridors.resolved.json. Offline:
// it reads the lock's raw files, never the network. Plan CNN lists must equal its output.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CorridorError,
  resolveCorridors,
  type CorridorSelector,
  type ResolvedCorridor
} from '../lib/lesscars/corridors';
import { loadLockedStreets, STREETS_SOURCE_ID } from '../lib/lesscars/streets';

const ENRICHMENT = resolve(import.meta.dirname, '../enrichment/lesscars');
export const CORRIDORS_JSON = join(ENRICHMENT, 'corridors.json');
export const CORRIDORS_RESOLVED_JSON = join(ENRICHMENT, 'corridors.resolved.json');

const SOURCE_ID = STREETS_SOURCE_ID;

export interface CorridorsFile {
  schema: 1;
  corridors: CorridorSelector[];
}

export interface CorridorsResolvedFile {
  schema: 1;
  source: { id: typeof SOURCE_ID; sha256: string[] };
  corridors: ResolvedCorridor[];
}

/** Parse corridors.json; throws naming the first malformed entry. */
export function parseCorridorsFile(text: string): CorridorsFile {
  const v = JSON.parse(text) as { schema?: unknown; corridors?: unknown };
  if (v.schema !== 1) throw new Error(`corridors.json: schema must be 1, got ${String(v.schema)}`);
  if (!Array.isArray(v.corridors)) throw new Error('corridors.json: corridors must be an array');
  v.corridors.forEach((c: Record<string, unknown>, i) => {
    for (const k of ['owner', 'street', 'from', 'to']) {
      if (typeof c?.[k] !== 'string' || c[k] === '') {
        throw new Error(`corridors.json: corridors[${i}].${k} must be a non-empty string`);
      }
    }
  });
  v.corridors.forEach((c: { as?: unknown }, i) => {
    if (c.as === undefined) return;
    const o = c.as as Record<string, unknown>;
    const bad = (k: string) => o[k] !== undefined && (typeof o[k] !== 'string' || o[k] === '');
    if (!o || typeof o !== 'object' || typeof o.reason !== 'string' || o.reason === '') {
      throw new Error(`corridors.json: corridors[${i}].as.reason must be a non-empty string`);
    }
    if (bad('from') || bad('to') || (o.from === undefined && o.to === undefined)) {
      throw new Error(`corridors.json: corridors[${i}].as needs a non-empty from or to`);
    }
  });
  return { schema: 1, corridors: v.corridors as CorridorSelector[] };
}

/** Prettier's JSON layout (the enrichment JSON is prettier-checked). */
async function formatJson(v: unknown): Promise<string> {
  const prettier = await import('prettier');
  return prettier.format(JSON.stringify(v), {
    parser: 'json',
    printWidth: 100,
    tabWidth: 2
  });
}

export async function lesscarsCnns(a: {
  lockPath: string;
  rawDir: string;
  inPath?: string;
  outPath?: string;
  /** Raw files by lock name rather than sha256 (the mini fixture). */
  byName?: boolean;
}): Promise<number> {
  const inPath = a.inPath ?? CORRIDORS_JSON;
  const outPath = a.outPath ?? CORRIDORS_RESOLVED_JSON;
  let segs: Awaited<ReturnType<typeof loadLockedStreets>>;
  try {
    segs = await loadLockedStreets({
      lockPath: a.lockPath,
      rawDir: a.rawDir,
      byName: a.byName,
      crs: 'EPSG:7131'
    });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  const { corridors } = parseCorridorsFile(readFileSync(inPath, 'utf8'));
  let resolved: ResolvedCorridor[];
  try {
    resolved = resolveCorridors(segs, corridors);
  } catch (e) {
    if (!(e instanceof CorridorError)) throw e;
    console.error(e.message);
    return 1;
  }
  const out: CorridorsResolvedFile = {
    schema: 1,
    source: { id: SOURCE_ID, sha256: segs.sha256 },
    corridors: resolved
  };
  writeFileSync(outPath, await formatJson(out));
  for (const c of resolved) {
    console.log(
      `${c.owner}: ${c.street}, ${c.from} → ${c.to}: ${c.cnn.length} CNNs, ${c.lengthM} m`
    );
  }
  console.log(`wrote ${outPath}`);
  return 0;
}
