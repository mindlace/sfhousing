// The options step (building-choice plan, Task 7): `scenarios/fzp/options.bin` (sfh-options/1,
// src/lib/data/option-table.ts), one row per parcels.bin row with the lot's pruned building
// options and its location value, and the panel's option rows per (lot, roll-year inputs) key in
// the build-internal `<derivedDir>/panel-options.bin` for the calibration. The candidates are
// generated in the scenario step on the worker pool here (`candidateRows`, options-worker.ts) and
// handed over; this step prunes them, adds locationValue, writes and reports.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  decodeOptionPayload,
  encodeOptionPayload,
  optionTableOf,
  type OptionTable
} from '../../src/lib/data/option-table';
import type { OptionTops } from '../../src/lib/data/envelope-row';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { scenarioRecordFrom } from '../../src/lib/data/scenario-codec';
import { fnv1a32 } from '../../src/lib/generator';
import {
  candidatesOf,
  eCrossings,
  isDistrictLot,
  pruneByCost,
  pruneOptions
} from '../../src/lib/sim/choice/options';
import { capHomes } from '../../src/lib/sim/choice/choose';
import { BUILDING_FORMS, BUILDING_TYPES, type Option } from '../../src/lib/sim/choice/types';
import type { ShippedStep } from '../lib/fzp-cal/shipped-step';
import { OPTIONS_BIN } from '../lib/scenario-files';

export { OPTIONS_BIN };
/** The golden's canonical dump of the decoded option table. */
export const OPTIONS_DUMP = 'scenarios/fzp/options.decoded.json';
/** The panel's option rows, one per `panel-options-keys.json` entry (derived cache, never shipped). */
export const PANEL_OPTIONS_BIN = 'panel-options.bin';
/** The panel rows' keys, in panel-options.bin row order (derived cache). */
export const PANEL_OPTIONS_KEYS = 'panel-options-keys.json';
/** Jobs a worker takes from the shared cursor at a time (default). */
export const OPTIONS_BATCH = 64;
/** The most homes an option row stores (u16); more is clamped and counted. */
const HOMES_MAX = 0xffff;
/** Values per packed option: type code, form code, stories, plates, homes. */
const PACK = 5;

const FIXTURE_RE = /^fixture-\d+$/;

/**
 * One candidate run: the chunk record `id` seen with these existing values and eligibility
 * (scenarioRecordFrom), as a parcels.bin row or a panel parcel-year. `prune`: return the options
 * with homes clamped to 65,535 and pruned (pruneOptions) instead of every candidate.
 */
export interface CandidateJob {
  id: string;
  existingUnits: number;
  existingFloorAreaM2: number;
  existingStories: number;
  eligible: boolean;
  prune?: boolean;
}

/** Per job: its options packed PACK values each (CSR), and whether the lot is a district. */
export interface CandidateRows {
  count: number;
  /** count + 1: job i's options are [offset[i], offset[i + 1]). */
  offset: Uint32Array;
  /** PACK values per option: type code, form code, stories, plates, homes (unclamped). */
  packed: Uint32Array;
  district: Uint8Array;
}

/** What the scenario step hands to the options step. */
export interface ScenarioCandidates {
  /** parcels.bin's ids, in row order. */
  lotIds: string[];
  /** One job per parcels.bin row, in row order: every candidate, unpruned. */
  lots: CandidateRows;
  /** One job per panel key, pruned. */
  panel: CandidateRows;
  panelKeys: CandidateJob[];
}

/** Every chunk record under `outDir/parcels/` (the build writes the chunks before the scenario step). */
export function loadChunkRecords(outDir: string): Map<ParcelId, ParcelRecord> {
  const dir = join(outDir, 'parcels');
  const records = new Map<ParcelId, ParcelRecord>();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    for (const r of decodeParcelChunk(readFileSync(join(dir, f), 'utf8'))) records.set(r.id, r);
  }
  return records;
}

function pack(options: readonly Option[]): Uint32Array {
  const out = new Uint32Array(PACK * options.length);
  options.forEach((o, k) => {
    out[PACK * k] = BUILDING_TYPES.indexOf(o.type);
    out[PACK * k + 1] = BUILDING_FORMS.indexOf(o.form);
    out[PACK * k + 2] = o.stories;
    out[PACK * k + 3] = o.plates;
    out[PACK * k + 4] = o.homes;
  });
  return out;
}

/** `options` with homes clamped to HOMES_MAX; `clamped` counts the options it changed. */
function clampHomes(options: Option[]): { options: Option[]; clamped: number } {
  let clamped = 0;
  const out = options.map((o) => {
    if (o.homes <= HOMES_MAX) return o;
    clamped++;
    return { ...o, homes: HOMES_MAX };
  });
  return { options: out, clamped };
}

/** Job `job`'s candidates on its chunk record, packed; empty when the chunks lack the record. */
export function candidatesForJob(
  records: ReadonlyMap<ParcelId, ParcelRecord>,
  job: CandidateJob
): { packed: Uint32Array; district: boolean } {
  const rec = records.get(job.id as ParcelId);
  if (!rec) return { packed: new Uint32Array(0), district: false };
  const view = scenarioRecordFrom(rec, job);
  const all = candidatesOf(view, fnv1a32(rec.id));
  // pruned as the options step prunes a lot's row: homes clamped first
  const out = job.prune ? pruneOptions(clampHomes(all).options) : all;
  return { packed: pack(out), district: isDistrictLot(rec) };
}

/**
 * The most homes after `cap` (`capHomes`) among job `i`'s options at or below `stories`, 0 when
 * none (envelope-row.ts `topHomesAt`, without building the options).
 */
export function rowTopHomes(
  c: CandidateRows,
  i: number,
  stories: number,
  cap: number | null,
  existingUnits: number
): number {
  let top = 0;
  for (let at = c.offset[i]; at < c.offset[i + 1]; at++) {
    const b = PACK * at;
    if (c.packed[b + 2] > stories) continue;
    top = Math.max(top, capHomes(c.packed[b + 4], cap, existingUnits));
  }
  return top;
}

/**
 * The candidates' stories and homes per job in CSR form (envelope-row.ts `OptionTops`), homes
 * clamped to 65,535 as options.bin stores them: the most homes at or below any story limit and cap
 * equal those of the job's options.bin row, whose pruning keeps every row's best option.
 */
export function candidateTops(c: CandidateRows): OptionTops {
  const total = c.offset[c.count];
  const stories = new Uint32Array(total);
  const homes = new Uint32Array(total);
  for (let at = 0; at < total; at++) {
    stories[at] = c.packed[PACK * at + 2];
    homes[at] = Math.min(HOMES_MAX, c.packed[PACK * at + 4]);
  }
  return { offset: c.offset, stories, homes };
}

/** Job `i`'s options. */
export function candidateRow(c: CandidateRows, i: number): Option[] {
  const out: Option[] = [];
  for (let at = c.offset[i]; at < c.offset[i + 1]; at++) {
    const b = PACK * at;
    out.push({
      type: BUILDING_TYPES[c.packed[b]],
      form: BUILDING_FORMS[c.packed[b + 1]],
      stories: c.packed[b + 2],
      plates: c.packed[b + 3],
      homes: c.packed[b + 4]
    });
  }
  return out;
}

function csrOf(rows: readonly Uint32Array[], district: Uint8Array): CandidateRows {
  const count = rows.length;
  const offset = new Uint32Array(count + 1);
  let total = 0;
  rows.forEach((r, i) => {
    offset[i] = total;
    total += r.length / PACK;
  });
  offset[count] = total;
  const packed = new Uint32Array(PACK * total);
  rows.forEach((r, i) => packed.set(r, PACK * offset[i]));
  return { count, offset, packed, district };
}

/** Jobs `[from, to)` of `c` as their own rows. */
export function sliceRows(c: CandidateRows, from: number, to: number): CandidateRows {
  const base = c.offset[from];
  return {
    count: to - from,
    offset: Uint32Array.from(c.offset.subarray(from, to + 1), (v) => v - base),
    packed: c.packed.slice(PACK * base, PACK * c.offset[to]),
    district: c.district.slice(from, to)
  };
}

/** The worker bootstrap: workers do not inherit the tsx loader, so register it through its API. */
function workerSource(): string {
  // The ESM entry from tsx's export map (the CommonJS one cannot be imported from ESM).
  const pkgFile = createRequire(import.meta.url).resolve('tsx/package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as {
    exports: { './esm/api': { import: { default: string } } };
  };
  const api = join(dirname(pkgFile), pkg.exports['./esm/api'].import.default);
  const self = new URL('./options-worker.ts', import.meta.url).href;
  return (
    `import(${JSON.stringify(pathToFileURL(api).href)})` +
    `.then((m) => (m.tsImport ?? m.default.tsImport)(${JSON.stringify(self)}, ${JSON.stringify(self)}))`
  );
}

/** Test hooks of the worker pool. */
export interface OptionsWorkerOpts {
  /** Jobs per batch; default OPTIONS_BATCH. */
  batch?: number;
  /** Called with each worker as it starts. */
  onWorker?: (w: Worker) => void;
  /** Test only: this worker throws at once and the others block until terminated. */
  failWorker?: number;
  /**
   * With 0 workers: the chunk records to run the jobs on instead of decoding `outDir`'s chunks
   * (the scenario step's in-memory records, for a run without written chunks).
   */
  records?: ReadonlyMap<ParcelId, ParcelRecord>;
}

/**
 * The candidates of `jobs` on `workers` threads that each decode `outDir`'s chunks; with 0
 * workers, in this thread on the same chunk records (or `opts.records`). When any worker fails, every worker is
 * terminated before the error is rethrown.
 */
export async function candidateRows(
  outDir: string,
  jobs: readonly CandidateJob[],
  workers: number,
  opts: OptionsWorkerOpts = {}
): Promise<CandidateRows> {
  const count = jobs.length;
  const rows: Uint32Array[] = new Array(count);
  const district = new Uint8Array(count);
  if (workers <= 0) {
    const records = opts.records ?? loadChunkRecords(outDir);
    jobs.forEach((job, i) => {
      const r = candidatesForJob(records, job);
      rows[i] = r.packed;
      district[i] = r.district ? 1 : 0;
    });
    return csrOf(rows, district);
  }
  const cursor = new Int32Array(new SharedArrayBuffer(4));
  const source = workerSource();
  const batch = opts.batch ?? OPTIONS_BATCH;
  const ws: Worker[] = [];
  const done = Array.from({ length: workers }, (_, index) => {
    const w = new Worker(source, {
      eval: true,
      workerData: { outDir, jobs, cursor, batch, index, failWorker: opts.failWorker }
    });
    ws.push(w);
    opts.onWorker?.(w);
    return new Promise<void>((res, rej) => {
      w.on('message', (msg: { start: number; rows: Uint32Array[]; district: Uint8Array }) => {
        msg.rows.forEach((r, k) => (rows[msg.start + k] = r));
        district.set(msg.district, msg.start);
      });
      w.on('error', rej);
      w.on('messageerror', rej);
      w.on('exit', (code) =>
        code === 0 ? res() : rej(new Error(`options: worker exited with code ${code}`))
      );
    });
  });
  try {
    await Promise.all(done);
  } catch (e) {
    // The others would otherwise run through every job, each holding the decoded city.
    await Promise.all(ws.map((w) => w.terminate()));
    throw e;
  }
  for (let i = 0; i < count; i++) {
    if (rows[i] === undefined) throw new Error(`options: no worker built job ${i}`);
  }
  return csrOf(rows, district);
}

/** Inflate and decode a written option table; throws an Error naming the file if it fails. */
export function readOptionsBin(file: string): OptionTable {
  try {
    return decodeOptionPayload(new Uint8Array(inflateRawSync(readFileSync(file))));
  } catch (e) {
    throw new Error(`options: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * The dump as the golden file stores it: canonical JSON with one line per row,
 * `[locationValue, [type, form, stories, plates, homes], ...]` with type and form by name.
 */
export function formatOptionsDump(t: OptionTable): string {
  const head = [
    `  "format": ${JSON.stringify(t.format)}`,
    `  "datasetVersion": ${JSON.stringify(t.datasetVersion)}`,
    `  "count": ${t.count}`
  ];
  const rows: string[] = [];
  for (let i = 0; i < t.count; i++) {
    const opts = [];
    for (let j = t.offset[i]; j < t.offset[i + 1]; j++) {
      opts.push([
        BUILDING_TYPES[t.type[j]],
        BUILDING_FORMS[t.form[j]],
        t.stories[j],
        t.plates[j],
        t.homes[j]
      ]);
    }
    rows.push(`    ${JSON.stringify([t.locationValue[i], ...opts])}`);
  }
  const body = rows.length > 0 ? `[\n${rows.join(',\n')}\n  ]` : '[]';
  return `{\n${head.join(',\n')},\n  "rows": ${body}\n}\n`;
}

/** The value at quantile `q` (nearest rank) of ascending `xs`; 0 when empty. */
function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  return xs[Math.max(0, Math.ceil(q * xs.length) - 1)];
}

function percentiles(c: Record<string, number>, key: string, xs: number[]): void {
  xs.sort((a, b) => a - b);
  c[`${key}.p50`] = quantile(xs, 0.5);
  c[`${key}.p90`] = quantile(xs, 0.9);
  c[`${key}.p99`] = quantile(xs, 0.99);
  c[`${key}.max`] = xs.length === 0 ? 0 : xs[xs.length - 1];
}

function writeTable(file: string, t: OptionTable): { payload: number; file: number } {
  const payload = encodeOptionPayload(t);
  mkdirSync(dirname(file), { recursive: true });
  const body = deflateRawSync(payload, { level: 9 });
  writeFileSync(file, body);
  readOptionsBin(file);
  return { payload: payload.length, file: body.length };
}

/**
 * Prune the scenario step's candidates, add each lot's locationValue (the build reads it with
 * locationValueByLot after the scenario SQL, since it reads sc_roll_agg; this module stays free of
 * DuckDB so the workers load it cheaply) and write `<outDir>/scenarios/fzp/options.bin`, then
 * the panel rows to `<derivedDir>/panel-options.bin` with their keys. A district parcel is one
 * row (ruling F6) and takes its own parcel id's value: the index is per lot id, and a district is
 * one lot id. Counts: `options.rows`, `options.lots` (rows with an option), `options.values`,
 * `options.per_lot.{p50,p90,p99,max}` over those lots, `options.clamped` (homes at 65,535),
 * `options.district_rows`, `options.e_crossings`, `options.per_lot_cost_pruned.{…}` and
 * `options.growth` (Σ options ÷ Σ cost-pruned, 4 decimals; pruneByCost on the candidates at the
 * shipped step, report only), `options.panel.rows`, `options.panel.values`,
 * `options.bytes.payload` and, off fixture versions, `options.bytes.file`.
 */
export function writeOptions(a: {
  outDir: string;
  derivedDir: string;
  datasetVersion: string;
  candidates: ScenarioCandidates;
  step: ShippedStep;
  /** Per lot id (locationValueByLot). */
  locationValue: ReadonlyMap<string, number>;
}): { counts: Record<string, number>; warnings: string[] } {
  const { lots, panel, panelKeys } = a.candidates;
  const valueOf = (id: string): number => {
    const v = a.locationValue.get(id);
    if (v === undefined) throw new Error(`options: lot ${id} has no location value`);
    return v;
  };
  const c: Record<string, number> = {};
  const warnings: string[] = [];
  const clampedIds: string[] = [];
  const perLot: number[] = [];
  const perLotCost: number[] = [];
  let clamped = 0;
  let districtRows = 0;
  let crossings = 0;
  let total = 0;
  let totalCost = 0;
  const { prices, heightTime } = a.step;
  if (heightTime.steps.length !== 1)
    throw new Error('options: the shipped height-time has one step');
  const time = heightTime.steps[0].value;
  const rows = Array.from({ length: lots.count }, (_, i) => {
    const id = a.candidates.lotIds[i];
    const cl = clampHomes(candidateRow(lots, i));
    if (cl.clamped > 0) {
      clamped += cl.clamped;
      clampedIds.push(id);
    }
    const options = pruneOptions(cl.options);
    if (lots.district[i]) districtRows++;
    if (cl.options.length > 0) {
      crossings += eCrossings(cl.options);
      const byCost = pruneByCost(cl.options, prices, time, heightTime.upTo).length;
      perLot.push(options.length);
      perLotCost.push(byCost);
      total += options.length;
      totalCost += byCost;
    }
    return { options, locationValue: valueOf(id) };
  });
  const t = optionTableOf(a.datasetVersion, rows);
  const bytes = writeTable(join(a.outDir, OPTIONS_BIN), t);

  // The panel: clamped and pruned in the workers, as the lots' rows above.
  const panelRows = panelKeys.map((k, i) => ({
    options: candidateRow(panel, i),
    locationValue: valueOf(k.id)
  }));
  const pt = optionTableOf(a.datasetVersion, panelRows);
  writeTable(join(a.derivedDir, PANEL_OPTIONS_BIN), pt);
  writeFileSync(
    join(a.derivedDir, PANEL_OPTIONS_KEYS),
    JSON.stringify(
      panelKeys.map((k) => ({
        mapblklot: k.id,
        existingUnits: k.existingUnits,
        existingFloorAreaM2: k.existingFloorAreaM2,
        existingStories: k.existingStories,
        eligible: k.eligible
      }))
    ) + '\n'
  );

  c['options.rows'] = t.count;
  c['options.lots'] = perLot.length;
  c['options.values'] = t.offset[t.count];
  percentiles(c, 'options.per_lot', perLot);
  c['options.clamped'] = clamped;
  c['options.district_rows'] = districtRows;
  c['options.e_crossings'] = crossings;
  percentiles(c, 'options.per_lot_cost_pruned', perLotCost);
  c['options.growth'] = totalCost === 0 ? 0 : Math.round((total / totalCost) * 1e4) / 1e4;
  c['options.panel.rows'] = pt.count;
  c['options.panel.values'] = pt.offset[pt.count];
  c['options.bytes.payload'] = bytes.payload;
  // Deflate bytes may differ across zlib builds, so fixture reports omit them (as parcels.bin's).
  if (!FIXTURE_RE.test(a.datasetVersion)) c['options.bytes.file'] = bytes.file;
  if (clampedIds.length > 0) {
    warnings.push(
      `options: ${clampedIds.length} lot(s) have options above ${HOMES_MAX} homes (clamped): ` +
        clampedIds.join(', ')
    );
  }
  return { counts: c, warnings };
}
