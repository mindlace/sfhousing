// The gross step: `scenarios/fzp/gross.bin` (sfh-gross/1, src/lib/data/gross-table.ts), one row per
// parcels.bin row with the lot's gross units at every story count up to its plateau, so the sim
// worker looks yields up instead of generating buildings. Runs after the scenario step; with
// `workers > 0` the rows are built on worker_threads (gross-worker.ts).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  GROSS_MAX,
  GROSS_STORIES_MAX,
  clampGross,
  decodeGrossPayload,
  encodeGrossPayload,
  grossRowOf,
  grossStoryBound,
  grossTableOf,
  type GrossRow,
  type GrossTable
} from '../../src/lib/data/gross-table';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { scenarioRecordOf, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { GROSS_BIN, PARCELS_BIN, readParcelsBin } from '../lib/scenario-files';

export { GROSS_BIN };
/** The golden's canonical dump of the decoded gross table. */
export const GROSS_DUMP = 'scenarios/fzp/gross.decoded.json';
/** Rows a worker takes from the shared cursor at a time (default). */
export const GROSS_BATCH = 64;

const FIXTURE_RE = /^fixture-\d+$/;

export interface GrossInputs {
  parcels: ScenarioParcels;
  records: Map<ParcelId, ParcelRecord>;
}

/**
 * parcels.bin and every chunk record under `outDir/parcels/` (read from the directory: the build
 * runs this before it writes the manifest). Imports no DuckDB, so workers load it cheaply.
 */
export function loadGrossInputs(outDir: string): GrossInputs {
  const parcels = readParcelsBin(join(outDir, PARCELS_BIN));
  const dir = join(outDir, 'parcels');
  const records = new Map<ParcelId, ParcelRecord>();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    for (const r of decodeParcelChunk(readFileSync(join(dir, f), 'utf8'))) records.set(r.id, r);
  }
  return { parcels, records };
}

/**
 * Row `i`'s gross row: its scenario record's yields; empty when the chunks lack the record. A row
 * whose plateau is its story bound (below GROSS_STORIES_MAX) is checked one story further: if the
 * curve still moves there, the bound cut it short and the build fails. `yieldOf` is a test seam
 * (in-thread path only); the default is the real `scenarioYield`.
 */
export function grossRowAt(
  inp: GrossInputs,
  i: number,
  yieldOf: (rec: ParcelRecord, stories: number) => number = (r, s) => scenarioYield(r, s, null)
): GrossRow {
  const rec = inp.records.get(inp.parcels.id[i] as ParcelId);
  const srec = rec && scenarioRecordOf(inp.parcels, i, rec);
  const row = grossRowOf(srec, yieldOf);
  if (srec) {
    const bound = grossStoryBound(srec);
    if (row.plateau > 0 && row.plateau === bound && bound < GROSS_STORIES_MAX) {
      const at = row.values[row.values.length - 1];
      const beyond = clampGross(yieldOf(srec, bound + 1));
      if (beyond !== at) {
        throw new Error(
          `gross: row ${i} (${inp.parcels.id[i]}) changes past its story bound ${bound}: ` +
            `g(${bound})=${at}, g(${bound + 1})=${beyond}`
        );
      }
    }
  }
  return row;
}

/** The worker bootstrap: workers do not inherit the tsx loader, so register it through its API. */
function workerSource(): string {
  // The ESM entry from tsx's export map (the CommonJS one cannot be imported from ESM).
  const pkgFile = createRequire(import.meta.url).resolve('tsx/package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as {
    exports: { './esm/api': { import: { default: string } } };
  };
  const api = join(dirname(pkgFile), pkg.exports['./esm/api'].import.default);
  const self = new URL('./gross-worker.ts', import.meta.url).href;
  return (
    `import(${JSON.stringify(pathToFileURL(api).href)})` +
    `.then((m) => (m.tsImport ?? m.default.tsImport)(${JSON.stringify(self)}, ${JSON.stringify(self)}))`
  );
}

/** Test hooks of grossRowsOnWorkers. */
export interface GrossWorkerOpts {
  /** Rows per batch; default GROSS_BATCH. */
  batch?: number;
  /** Called with each worker as it starts. */
  onWorker?: (w: Worker) => void;
  /** Test only: this worker throws at once and the others block until terminated. */
  failWorker?: number;
}

/**
 * The rows of a table of `count` rows, built on `workers` threads that each load `outDir`'s
 * inputs. When any worker fails, every worker is terminated before the error is rethrown.
 */
export async function grossRowsOnWorkers(
  outDir: string,
  count: number,
  workers: number,
  opts: GrossWorkerOpts = {}
): Promise<GrossRow[]> {
  const rows: GrossRow[] = new Array(count);
  const cursor = new Int32Array(new SharedArrayBuffer(4));
  const source = workerSource();
  const batch = opts.batch ?? GROSS_BATCH;
  const ws: Worker[] = [];
  const done = Array.from({ length: workers }, (_, index) => {
    const w = new Worker(source, {
      eval: true,
      workerData: { outDir, cursor, count, batch, index, failWorker: opts.failWorker }
    });
    ws.push(w);
    opts.onWorker?.(w);
    return new Promise<void>((res, rej) => {
      w.on('message', (msg: { start: number; rows: GrossRow[] }) => {
        msg.rows.forEach((r, k) => (rows[msg.start + k] = r));
      });
      w.on('error', rej);
      w.on('messageerror', rej);
      w.on('exit', (code) =>
        code === 0 ? res() : rej(new Error(`gross: worker exited with code ${code}`))
      );
    });
  });
  try {
    await Promise.all(done);
  } catch (e) {
    // The others would otherwise run through the whole table, each holding the decoded city.
    await Promise.all(ws.map((w) => w.terminate()));
    throw e;
  }
  for (let i = 0; i < count; i++) {
    if (rows[i] === undefined) throw new Error(`gross: no worker built row ${i}`);
  }
  return rows;
}

/** Inflate and decode a written gross.bin; throws an Error naming the file if it fails. */
export function readGrossBin(file: string): GrossTable {
  try {
    return decodeGrossPayload(new Uint8Array(inflateRawSync(readFileSync(file))));
  } catch (e) {
    throw new Error(`gross: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * The dump as the golden file stores it: canonical JSON with one `[first, plateau, ...values]` line
 * per row.
 */
export function formatGrossDump(t: GrossTable): string {
  const head = [
    `  "format": ${JSON.stringify(t.format)}`,
    `  "datasetVersion": ${JSON.stringify(t.datasetVersion)}`,
    `  "count": ${t.count}`
  ];
  const rows: string[] = [];
  for (let i = 0; i < t.count; i++) {
    const values = t.values.subarray(t.offset[i], t.offset[i + 1]);
    rows.push(`    ${JSON.stringify([t.first[i], t.plateau[i], ...values])}`);
  }
  const body = rows.length > 0 ? `[\n${rows.join(',\n')}\n  ]` : '[]';
  return `{\n${head.join(',\n')},\n  "rows": ${body}\n}\n`;
}

/**
 * Build and write `<outDir>/scenarios/fzp/gross.bin` from parcels.bin and the chunks already in
 * `outDir`, then decode what was written. `workers` 0 builds in this thread. Counts: `gross.rows`,
 * `gross.values`, `gross.clamped` (values at GROSS_MAX), `gross.plateau_max`,
 * `gross.bytes.payload` and, off fixture versions, `gross.bytes.file`. One warning names every
 * lot with a clamped value.
 */
export async function writeGross(a: {
  outDir: string;
  datasetVersion: string;
  workers: number;
  /** Rows per worker batch; default GROSS_BATCH. */
  batch?: number;
  /** Test seam, in-thread path only (`workers` 0): replaces the real yield function. */
  yieldOf?: (rec: ParcelRecord, stories: number) => number;
}): Promise<{ counts: Record<string, number>; warnings: string[] }> {
  // On the worker path this thread needs only parcels.bin (the count and the ids).
  let parcels: ScenarioParcels;
  let rows: GrossRow[];
  if (a.workers > 0) {
    parcels = readParcelsBin(join(a.outDir, PARCELS_BIN));
    rows = await grossRowsOnWorkers(a.outDir, parcels.count, a.workers, { batch: a.batch });
  } else {
    const inp = loadGrossInputs(a.outDir);
    parcels = inp.parcels;
    rows = Array.from({ length: parcels.count }, (_, i) => grossRowAt(inp, i, a.yieldOf));
  }
  const count = parcels.count;
  const t = grossTableOf(a.datasetVersion, rows);
  const payload = encodeGrossPayload(t);
  const file = join(a.outDir, GROSS_BIN);
  mkdirSync(dirname(file), { recursive: true });
  const body = deflateRawSync(payload, { level: 9 });
  writeFileSync(file, body);
  readGrossBin(file);

  const c: Record<string, number> = {};
  const clampedIds: string[] = [];
  let clamped = 0;
  let plateauMax = 0;
  rows.forEach((r, i) => {
    clamped += r.clamped;
    if (r.clamped > 0) clampedIds.push(parcels.id[i]);
    if (r.plateau > plateauMax) plateauMax = r.plateau;
  });
  c['gross.rows'] = count;
  c['gross.values'] = t.values.length;
  c['gross.clamped'] = clamped;
  c['gross.plateau_max'] = plateauMax;
  c['gross.bytes.payload'] = payload.length;
  // Deflate bytes may differ across zlib builds, so fixture reports omit them (as parcels.bin's).
  if (!FIXTURE_RE.test(a.datasetVersion)) c['gross.bytes.file'] = body.length;
  const warnings =
    clampedIds.length > 0
      ? [
          `gross: ${clampedIds.length} lot(s) reach ${GROSS_MAX} gross units (clamped): ` +
            clampedIds.join(', ')
        ]
      : [];
  return { counts: c, warnings };
}
