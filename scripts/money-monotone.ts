// `npx tsx scripts/money-monotone.ts <datasetDir> | --version <v> [--from <origin>] [--presets a,b]
// [--out <file.jsonl>] [--cars on|off]`: the money monotonicity check. Runs every subset of the
// offered funding presets through the timeline engine on a dataset and reads the homes at the
// deadline years; a preset added to a set must not cost the set more than MONOTONE_TOLERANCE
// homes on any reading. Exits 0 monotone, 1 an offender, 2 when the check could not run (one
// stderr line, `money-monotone: {reason}`, nothing on stdout).
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { utcParts } from '../src/lib/fzp/time';
import { fundingPresets } from '../src/lib/sim-page/funding-presets';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import type { Calibration } from '../src/lib/timelapse/types';
import { addPolicy } from '../src/lib/timeline/add';
import { DEFAULT_POLICY4, type SimPolicy4 } from '../src/lib/timeline/policy4';
import { openEngine, parseSourceArgs, type Engine } from './lib/engine-runner';

/** A reading may fall this many homes when a preset is added; one more is an offender. */
export const MONOTONE_TOLERANCE = 5;
/** The December of each of these years is read. */
export const DEADLINE_YEARS = [2035, 2040, 2045, 2055, 2060] as const;

export type Reading = 'net' | 'funded' | 'affordable';
const READINGS: readonly Reading[] = ['net', 'funded', 'affordable'];
/** By deadline year. */
export type Readings = Record<number, Record<Reading, number>>;

export interface SetReadings {
  set: string[];
  secs: number;
  at: Readings;
}

export interface Offender {
  from: string[];
  added: string;
  reading: Reading;
  year: number;
  before: number;
  after: number;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The ids of the presets the data offers that add money, in list order: available ones, less
 * those that withdraw a pool (`state-off`, `federal-credits-off`: a baseline scale under 1).
 * Adding a withdrawal builds fewer homes by design, so it is not a case of more money.
 */
export function offeredPresets(cal: Calibration): string[] {
  return fundingPresets(cal)
    .filter((p) => p.available && !p.baselineScale.some((s) => s.scale < 1))
    .map((p) => p.id);
}

/** Every subset of `ids` (2^n), members in `ids` order; the empty set first. */
export function subsetsOf(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    out.push(ids.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  return out;
}

/** Every (S, p) with p not in S: the set `S` and the preset added to it. */
export function edgesOf(ids: readonly string[]): [string[], string][] {
  const edges: [string[], string][] = [];
  for (const s of subsetsOf(ids)) {
    for (const p of ids) if (!s.includes(p)) edges.push([s, p]);
  }
  return edges;
}

/**
 * The policy document that adds each preset of `set`, in `ids` order, from month 1 of the window.
 * Prerequisites are ignored.
 */
export function docFor(set: readonly string[], cal: Calibration, asOf: Day): SimPolicy4 {
  const ctx = { w: { asOf, months: WINDOW_MONTHS }, month: 1, cal };
  let doc = DEFAULT_POLICY4;
  for (const preset of set) {
    doc = addPolicy(doc, { kind: 'money', what: 'preset', preset }, ctx).doc;
  }
  return doc;
}

/** The three readings at the December of each deadline year. */
export function readingsOf(view: TimelineView): Readings {
  const out: Readings = {};
  for (const year of DEADLINE_YEARS) {
    const i = view.months.findIndex((d) => {
      const { y, m } = utcParts(d);
      return y === year && m === 12;
    });
    if (i < 0) throw new Error(`the window has no December ${year}`);
    if (i > view.filledThrough) throw new Error(`December ${year} is past the filled months`);
    const t = view.tiers?.[i];
    out[year] = {
      net: view.rows[i].completedNet,
      funded: view.money?.fundedHomes[i] ?? 0,
      affordable: t === undefined ? 0 : t.veryLow + t.low + t.moderate
    };
  }
  return out;
}

const keyOf = (set: readonly string[]) => set.join('|');

/** Each reading that falls by more than `tol` homes when a preset is added to a set. */
export function offenders(
  all: readonly SetReadings[],
  ids: readonly string[],
  tol: number = MONOTONE_TOLERANCE
): Offender[] {
  const byKey = new Map(all.map((r) => [keyOf(r.set), r]));
  const out: Offender[] = [];
  for (const [from, added] of edgesOf(ids)) {
    const before = byKey.get(keyOf(from));
    const after = byKey.get(keyOf(ids.filter((id) => id === added || from.includes(id))));
    if (before === undefined || after === undefined) continue;
    for (const reading of READINGS) {
      for (const year of DEADLINE_YEARS) {
        const b = before.at[year]?.[reading];
        const a = after.at[year]?.[reading];
        if (b === undefined || a === undefined) continue;
        if (b - a > tol) out.push({ from, added, reading, year, before: b, after: a });
      }
    }
  }
  return out;
}

/**
 * Runs the subsets of `opts.presets` (default every offered preset; kept in offered order)
 * one at a time through the engine.
 */
export async function runMonotone(
  engine: Engine,
  opts: { presets?: string[] } = {}
): Promise<{ ids: string[]; sets: SetReadings[]; offenders: Offender[] }> {
  const offered = offeredPresets(engine.cal);
  const wanted = opts.presets;
  if (wanted !== undefined) {
    for (const p of wanted) if (!offered.includes(p)) throw new Error(`preset ${p} is not offered`);
  }
  const ids = wanted === undefined ? offered : offered.filter((id) => wanted.includes(id));
  const sets: SetReadings[] = [];
  for (const set of subsetsOf(ids)) {
    const t0 = performance.now();
    const view = await engine.view(docFor(set, engine.cal, engine.asOf));
    sets.push({
      set,
      secs: (performance.now() - t0) / 1000,
      at: readingsOf(view)
    });
  }
  return { ids, sets, offenders: offenders(sets, ids) };
}

/** The lines the command prints: the dataset, the presets, each drop, the verdict. */
export function monotoneLines(r: {
  datasetVersion: string;
  ids: string[];
  offenders: Offender[];
}): string[] {
  const lines = [`Dataset ${r.datasetVersion}`, `Presets: ${r.ids.join(', ')}`];
  for (const o of r.offenders) {
    lines.push(
      `Drop: ${o.reading} Dec ${o.year}, [${o.from.join(', ')}] + ${o.added}: ` +
        `${o.before} -> ${o.after} (${o.after - o.before})`
    );
  }
  if (r.offenders.length === 0) {
    lines.push(`Monotone: no reading drops more than ${MONOTONE_TOLERANCE} homes`);
  } else {
    const edges = new Set(r.offenders.map((o) => `${keyOf(o.from)}>${o.added}`));
    lines.push(`Not monotone: ${r.offenders.length} drops on ${edges.size} edges`);
  }
  return lines;
}

export const monotoneExit = (offs: readonly Offender[]): 0 | 1 => (offs.length === 0 ? 0 : 1);

const USAGE =
  'usage: npx tsx scripts/money-monotone.ts <datasetDir> | --version <v> [--from <origin>] ' +
  '[--presets a,b] [--out <file.jsonl>] [--cars on|off]';

async function main(argv: string[]): Promise<number> {
  const parsed = parseSourceArgs(argv, { presets: 'value', out: 'value', cars: 'value' });
  if ('error' in parsed) {
    console.error(
      `money-monotone: ${parsed.error.startsWith('give a dataset') ? USAGE : parsed.error}`
    );
    return 2;
  }
  const { presets, out, cars = 'on' } = parsed.flags;
  if (cars !== 'on' && cars !== 'off') {
    console.error(`money-monotone: --cars must be on or off, got ${String(cars)}`);
    return 2;
  }
  let engine: Engine | null = null;
  try {
    engine = await openEngine(parsed.src, { warn: (msg) => console.error(msg), cars });
    const t0 = performance.now();
    const r = await runMonotone(engine, {
      presets: typeof presets === 'string' ? presets.split(',').filter((p) => p !== '') : undefined
    });
    if (typeof out === 'string') {
      writeFileSync(out, r.sets.map((s) => JSON.stringify(s)).join('\n') + '\n');
    }
    const secs = (performance.now() - t0) / 1000;
    for (const line of monotoneLines({ datasetVersion: engine.datasetVersion, ...r })) {
      console.log(line);
    }
    console.error(`Ran ${r.sets.length} sets in ${secs.toFixed(1)} s (cars ${cars})`);
    return monotoneExit(r.offenders);
  } catch (e) {
    console.error(`money-monotone: ${messageOf(e)}`);
    return 2;
  } finally {
    engine?.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`money-monotone: ${messageOf(e)}`);
      process.exitCode = 2;
    }
  );
}
