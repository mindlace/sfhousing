// Frontage build step (sim data layers, plan 1 Task 10): runs 83_frontage.sql and writes
// `scenarios/fzp/frontage.bin` (codec `sfh-frontage/1`), one row per parcel in parcels.bin order:
// the DataSF street segments (3psu-pn9h) each lot fronts (depth 0) or lies one lot deep behind
// (depth 1). Plan 3's street brush reads it through `frontingRows`. No segment geometry ships.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { idsHash } from '../../src/lib/data/column-file';
import {
  FRONTAGE_FORMAT,
  STREET_CLASSES,
  decodeFrontagePayload,
  encodeFrontagePayload,
  type Frontage
} from '../../src/lib/data/frontage-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { Provenance } from '../../src/lib/timelapse/types';
import { runSqlFile, type Duck } from '../lib/duck';
import { recordQuality } from '../lib/quality';
import { FRONTAGE_BIN, PARCELS_BIN } from '../lib/scenario-files';
import { DATASF } from '../sources/datasf';
import { readParcelsBin } from './scenario';

export { FRONTAGE_BIN };
/** The T14 rules writeFrontage counts in TS. */
export const FRONTAGE_TS_RULES = ['sd.streets.no-frontage'] as const;
/** The golden's canonical dump of the decoded frontage payload. */
export const FRONTAGE_DUMP = 'scenarios/fzp/frontage.decoded.json';

const SQL_FILE = resolve(import.meta.dirname, '../sql/83_frontage.sql');
const FIXTURE_RE = /^fixture-\d+$/;
/** u16 frontSeg / segName indices and the u8 frontCount (sfh-frontage/1). */
const MAX_SEGMENTS = 0xffff;
const MAX_ROW_ENTRIES = 0xff;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Run 83_frontage.sql on a database with `parcels` (id, geom_orig) and `src_streets`. Writes
 * fr_seg and fr_front (id, seg_idx, depth), plus its working tables. Idempotent on one database.
 */
export async function runFrontageSql(db: Duck): Promise<void> {
  await runSqlFile(db, SQL_FILE);
}

const PROVENANCE: Provenance = {
  tier: 3,
  label: 'Street frontage',
  sources: [
    { label: DATASF['datasf-streets'].label, url: DATASF['datasf-streets'].homepage },
    { label: DATASF['datasf-parcels'].label, url: DATASF['datasf-parcels'].homepage }
  ],
  method:
    'DataSF street centerlines of classcode 2 to 5 (major, arterial, collector, residential) ' +
    'off the paper, private and pseudo layers, matched to the DataSF parcel outline. A lot ' +
    'fronts a segment (depth 0) within 40 m when the part of its boundary within its distance ' +
    'plus 2 m of the segment is at least 5 m long and the line from that edge’s midpoint to the ' +
    'segment crosses no other parcel by more than 0.5 m. A lot is one lot deep (depth 1) when it ' +
    'shares at least 3 m of boundary with a lot fronting the segment and its own line to the ' +
    'segment crosses that lot, and no other, by more than 0.5 m. Thresholds are tier 4.'
};

/** Canonical JSON form of a decoded frontage payload: plain arrays, rows as entry lists. */
export function frontageDump(f: Frontage): unknown {
  const rows: [number, number][][] = [];
  for (let i = 0; i < f.count; i++) {
    const r: [number, number][] = [];
    for (let e = f.rowStart[i]; e < f.rowStart[i + 1]; e++)
      r.push([f.frontSeg[e], f.frontDepth[e]]);
    rows.push(r);
  }
  return {
    format: f.format,
    datasetVersion: f.datasetVersion,
    count: f.count,
    idsHash: f.idsHash,
    provenance: {
      tier: f.provenance.tier,
      label: f.provenance.label,
      sources: f.provenance.sources.map((s) => ({ label: s.label, url: s.url })),
      method: f.provenance.method
    },
    names: [...f.names],
    segCnn: Array.from(f.segCnn),
    segName: Array.from(f.segName),
    segClass: Array.from(f.segClass),
    rows
  };
}

/** The dump as the golden file stores it. */
export function formatFrontageDump(f: Frontage): string {
  return JSON.stringify(frontageDump(f), null, 2) + '\n';
}

/** Inflate and decode a written frontage.bin against its parcels.bin; throws naming the file. */
export function readFrontageBin(file: string, parcels: ScenarioParcels): Frontage {
  try {
    return decodeFrontagePayload(new Uint8Array(inflateRawSync(readFileSync(file))), parcels);
  } catch (e) {
    throw new Error(`frontage: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * The frontage build step. Needs `parcels` (geom_orig), `src_streets` and the scenario step's
 * `scenarios/fzp/parcels.bin`. Runs runFrontageSql, writes `<outDir>/scenarios/fzp/frontage.bin`
 * and reports sd.streets.no-frontage (eligible parcels with no depth-0 entry) into `buildCounts`.
 * Returns the frontage.* counts. Throws on more than 65,535 segments, a row with more than 255
 * entries, a fr_front id that is not in parcels.bin, or a written file that does not decode.
 */
export async function writeFrontage(a: {
  db: Duck;
  outDir: string;
  datasetVersion: string;
  buildCounts: Record<string, number>;
}): Promise<{ counts: Record<string, number>; warnings: string[] }> {
  const { db } = a;
  const s = readParcelsBin(join(a.outDir, PARCELS_BIN));
  await runFrontageSql(db);

  const segs = await db.all<{ seg_idx: number; cnn: number; name: string; class: number }>(
    'SELECT seg_idx, cnn, name, class FROM fr_seg ORDER BY seg_idx'
  );
  if (segs.length > MAX_SEGMENTS)
    throw new Error(`frontage: ${segs.length} segments, more than ${MAX_SEGMENTS}`);
  // JS string order (UTF-16 code units), as the decoder checks, not DuckDB collation.
  const names = [...new Set(segs.map((g) => g.name))].sort(cmp);
  const nameIdx = new Map(names.map((nm, k) => [nm, k]));
  const S = segs.length;
  const segCnn = new Uint32Array(S);
  const segName = new Uint16Array(S);
  const segClass = new Uint8Array(S);
  segs.forEach((g, k) => {
    if (g.seg_idx !== k) throw new Error(`frontage: fr_seg seg_idx ${g.seg_idx} at ${k}`);
    if (!(Number.isInteger(g.cnn) && g.cnn >= 0 && g.cnn <= 0xffffffff))
      throw new Error(`frontage: cnn ${g.cnn} does not fit u32`);
    if (!(g.class >= 0 && g.class < STREET_CLASSES.length))
      throw new Error(`frontage: classcode ${g.class} outside STREET_CLASSES`);
    segCnn[k] = g.cnn;
    segName[k] = nameIdx.get(g.name)!;
    segClass[k] = g.class;
  });

  const front = await db.all<{ id: string; seg_idx: number; depth: number }>(
    'SELECT id, seg_idx, depth FROM fr_front ORDER BY id, depth, seg_idx'
  );
  const n = s.count;
  const byRow: [seg: number, depth: number][][] = Array.from({ length: n }, () => []);
  for (const r of front) {
    const i = s.index.get(r.id);
    if (i === undefined) throw new Error(`frontage: fr_front id ${r.id} is not in parcels.bin`);
    byRow[i].push([r.seg_idx, r.depth]);
  }
  const rowStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    if (byRow[i].length > MAX_ROW_ENTRIES)
      throw new Error(
        `frontage: parcel ${s.id[i]} has ${byRow[i].length} entries, more than ${MAX_ROW_ENTRIES}`
      );
    byRow[i].sort((x, y) => x[1] - y[1] || x[0] - y[0]);
    rowStart[i + 1] = rowStart[i] + byRow[i].length;
  }
  const E = rowStart[n];
  const frontSeg = new Uint16Array(E);
  const frontDepth = new Uint8Array(E);
  for (let i = 0; i < n; i++)
    byRow[i].forEach(([seg, depth], k) => {
      frontSeg[rowStart[i] + k] = seg;
      frontDepth[rowStart[i] + k] = depth;
    });

  const f: Frontage = {
    format: FRONTAGE_FORMAT,
    datasetVersion: a.datasetVersion,
    count: n,
    idsHash: idsHash(s.id),
    provenance: PROVENANCE,
    names,
    segCnn,
    segName,
    segClass,
    rowStart,
    frontSeg,
    frontDepth
  };

  // ---- Counts ----
  const c: Record<string, number> = {
    'frontage.segments': S,
    'frontage.entries.depth0': front.filter((r) => r.depth === 0).length,
    'frontage.entries.depth1': front.filter((r) => r.depth === 1).length
  };
  const noFrontage: string[] = [];
  let eligible = 0;
  let corner = 0;
  for (let i = 0; i < n; i++) {
    const streets = new Set(byRow[i].filter(([, d]) => d === 0).map(([seg]) => segName[seg]));
    if (streets.size >= 2) corner++;
    if (s.eligible[i] !== 1) continue;
    eligible++;
    if (streets.size === 0) noFrontage.push(s.id[i]);
  }
  c['frontage.no_frontage'] = noFrontage.length;
  c['frontage.corner'] = corner;
  // A depth-1 entry with no neighbour fronting its segment at depth 0, or repeating its own depth-0
  // entry (V34 requires 0).
  const [orphan] = await db.all<{ n: number }>(
    `SELECT count(*)::INTEGER AS n FROM fr_front f
     WHERE f.depth = 1 AND (
       NOT EXISTS (SELECT 1 FROM fr_adj j JOIN fr_front g ON g.id = j.a
                   WHERE j.b = f.id AND g.seg_idx = f.seg_idx AND g.depth = 0)
       OR EXISTS (SELECT 1 FROM fr_front g
                  WHERE g.id = f.id AND g.seg_idx = f.seg_idx AND g.depth = 0))`
  );
  c['frontage.depth1_orphan'] = orphan.n;

  // ---- File: encode, deflate, write, then decode what was written ----
  const payload = encodeFrontagePayload(f);
  const file = join(a.outDir, FRONTAGE_BIN);
  mkdirSync(dirname(file), { recursive: true });
  const body = deflateRawSync(payload, { level: 9 });
  writeFileSync(file, body);
  c['frontage.bytes.payload'] = payload.length;
  // Deflate bytes may differ across zlib builds, so fixture reports omit them (as parcels.bin's).
  if (!FIXTURE_RE.test(a.datasetVersion)) c['frontage.bytes.file'] = body.length;
  readFrontageBin(file, s);

  // ---- T14: eligible parcels with no depth-0 frontage ----
  recordQuality(a.buildCounts, FRONTAGE_TS_RULES[0], {
    fired: noFrontage.length,
    of: eligible,
    sample: noFrontage
  });

  const counts = Object.fromEntries(Object.entries(c).sort(([x], [y]) => cmp(x, y)));
  return { counts, warnings: [] };
}
