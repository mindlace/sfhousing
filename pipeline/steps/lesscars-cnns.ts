// `npm run pipeline -- lesscars-cnns`: resolve the /lesscars corridor selectors
// (pipeline/enrichment/lesscars/corridors.json, a transcription of plan-v1 Appendix A) to CNN
// lists from the locked datasf-streets raw files, and write corridors.resolved.json. Offline:
// it reads the lock's raw files, never the network. Plan CNN lists must equal its output.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDuck } from '../lib/duck';
import {
  CorridorError,
  resolveCorridors,
  type CorridorSelector,
  type ResolvedCorridor,
  type StreetSeg
} from '../lib/lesscars/corridors';
import { rawPath, readLock } from '../lib/lock';
import { normalise } from '../sources/normalise';

const ENRICHMENT = resolve(import.meta.dirname, '../enrichment/lesscars');
export const CORRIDORS_JSON = join(ENRICHMENT, 'corridors.json');
export const CORRIDORS_RESOLVED_JSON = join(ENRICHMENT, 'corridors.resolved.json');

const SOURCE_ID = 'datasf-streets';

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

type Geo =
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] };

const linesOf = (g: Geo): [number, number][][] =>
  g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];

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
  if (!existsSync(a.lockPath)) {
    console.error(`no ${a.lockPath}: run \`npm run pipeline -- fetch\` first`);
    return 1;
  }
  const entry = readLock(a.lockPath).sources.find((s) => s.id === SOURCE_ID);
  if (!entry) {
    console.error(`${a.lockPath} has no ${SOURCE_ID} entry: fetch it with --only ${SOURCE_ID}`);
    return 1;
  }
  const files = entry.files.map((f) => rawPath(a.rawDir, f, a.byName));
  const missing = entry.files.filter((_, i) => !existsSync(files[i]));
  if (missing.length > 0) {
    for (const f of missing)
      console.error(`${SOURCE_ID}: missing raw file ${f.name} (${f.sha256})`);
    return 1;
  }
  const { corridors } = parseCorridorsFile(readFileSync(inPath, 'utf8'));

  const tmp = mkdtempSync(join(tmpdir(), 'sfh-lc-cnns-'));
  const db = await openDuck();
  let segs: StreetSeg[];
  try {
    const parquet = join(tmp, `${SOURCE_ID}.parquet`);
    await normalise(db, SOURCE_ID, files, parquet);
    const rows = await db.all<{
      cnn: string;
      streetname: string | null;
      f_st: string | null;
      t_st: string | null;
      g: string;
    }>(
      `SELECT cnn, streetname, f_st, t_st, ST_AsGeoJSON(geom) g
       FROM read_parquet('${parquet.replaceAll("'", "''")}')
       WHERE cnn IS NOT NULL AND streetname IS NOT NULL AND geom IS NOT NULL ORDER BY cnn`
    );
    segs = rows.map((r) => ({
      cnn: r.cnn,
      streetname: r.streetname!,
      fSt: r.f_st,
      tSt: r.t_st,
      lines: linesOf(JSON.parse(r.g) as Geo)
    }));
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }

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
    source: { id: SOURCE_ID, sha256: entry.files.map((f) => f.sha256) },
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
