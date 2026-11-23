// `npx tsx scripts/level2-check.ts <datasetDir> [--amount <homes>]`: the level 2 check (G4's build
// check). Runs the empty policy document through the timeline host on a built dataset directory and
// reports whether current law reaches the goal inside the window. Exits 0 reached, 1 missed, 2 when
// the check could not run (one stderr line, `level2-check: {reason}`, nothing on stdout).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseManifest, type Manifest } from '../src/lib/data/manifest';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { utcParts } from '../src/lib/fzp/time';
import { defaultGoal, readGoal, TODAY, type Goal } from '../src/lib/goal/goal';
import type { FetchLike } from '../src/lib/sim/chunks';
import { loadScenario, scenarioUrls, type FetchBytesLike } from '../src/lib/sim/scenario/load';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import type { TimelineHostResponse } from '../src/lib/sim/timeline-protocol';
import { createTimelineHost } from '../src/lib/sim/world/host';
import type { ScoreStatics, SeriesChunk, TimelineView } from '../src/lib/sim/world/score/types';
import { viewOf } from '../src/lib/sim/world/score/view';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4 } from '../src/lib/timeline/policy4';
import { reconcilePolicy4 } from '../src/lib/timeline/reconcile4';

export interface EmptyRun {
  datasetVersion: string;
  asOf: Day;
  view: TimelineView;
}

export interface Level2Result {
  datasetVersion: string;
  amount: number;
  /** The goal's deadline: the window's last whole calendar month. */
  deadline: Day;
  /** The first month the amount is met; null when it is not met by the deadline. */
  reachedOn: Day | null;
  /** Homes counted by the goal's measure at the deadline month. */
  homesAtDeadline: number;
  /** Calendar months from reachedOn to the deadline; null when missed. */
  marginMonths: number | null;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const REV = 1;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `<dir>/manifest.json`, parsed; rejects with `no dataset at {dir}`. */
function readManifest(dir: string): Manifest {
  try {
    return parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  } catch {
    throw new Error(`no dataset at ${dir}`);
  }
}

/** `/data/<datasetVersion>/<path>` served from `<dir>/<path>`; a missing file answers 404. */
function dirFetch(
  dir: string,
  manifest: Manifest
): { fetch: FetchLike; fetchBytes: FetchBytesLike } {
  const prefix = `/data/${manifest.datasetVersion}/`;
  const read = (url: string): Buffer | null => {
    if (!url.startsWith(prefix)) return null;
    try {
      return readFileSync(join(dir, url.slice(prefix.length)));
    } catch {
      return null;
    }
  };
  return {
    fetch: async (url) => {
      const b = read(url);
      return b === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')) };
    },
    fetchBytes: async (url) => {
      const b = read(url);
      return b === null
        ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        : {
            ok: true,
            status: 200,
            arrayBuffer: async () =>
              b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
          };
    }
  };
}

/** Real timers whose live handles are tracked, so every one can be cleared; none after `close`. */
function trackedTimers() {
  const live = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  return {
    setTimeout(fn: () => void, ms: number): unknown {
      if (closed) return null;
      const h = setTimeout(() => {
        live.delete(h);
        fn();
      }, ms);
      live.add(h);
      return h;
    },
    clearTimeout(h: unknown): void {
      if (h === null) return;
      live.delete(h as ReturnType<typeof setTimeout>);
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
    close(): void {
      closed = true;
      for (const h of live) clearTimeout(h);
      live.clear();
    }
  };
}

/** The bbox covering every chunk of the manifest. */
function allBbox(m: Manifest): [number, number, number, number] {
  const b = m.chunks.map((c) => c.bbox);
  return [
    Math.min(...b.map((x) => x[0])),
    Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])),
    Math.max(...b.map((x) => x[3]))
  ];
}

/** Load the dataset from disk and fill the whole window for the empty document. */
export async function runEmptyDocument(
  dir: string,
  opts: { warn?: (msg: string) => void; timeoutMs?: number } = {}
): Promise<EmptyRun> {
  const warn = opts.warn ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const manifest = readManifest(dir);
  const { fetch, fetchBytes } = dirFetch(dir, manifest);
  const timers = trackedTimers();

  let host: ReturnType<typeof createTimelineHost> | null = null;
  let guard: ReturnType<typeof setTimeout> | null = null;
  try {
    const urls = scenarioUrls(manifest);
    if (urls === null) {
      throw new Error(
        `host error: scenario-missing: dataset ${manifest.datasetVersion} has no fzp scenario`
      );
    }
    // The host loads again and passes its own warnings on; this load's are the same, dropped.
    const loaded = await loadScenario(
      { fetch, fetchBytes, setTimeout: timers.setTimeout, retryDelaysMs: [], warn: () => {} },
      urls,
      () => false
    );
    if (!('fzp' in loaded)) throw new Error(`host error: ${loaded.code}: ${loaded.message}`);
    const { calibration, asOf } = loaded.fzp;
    const policy = reconcilePolicy4(DEFAULT_POLICY4, calibration, asOf).doc;

    const view = await new Promise<TimelineView>((resolve, reject) => {
      let statics: ScoreStatics | null = null;
      const chunks: SeriesChunk[] = [];
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      const post = (msg: TimelineHostResponse) => {
        if (settled) return;
        if (msg.type === 'error') return fail(`host error: ${msg.code}: ${msg.message}`);
        if (msg.type === 'compiled' && msg.rev === REV) statics = msg.statics;
        else if (msg.type === 'filled' && msg.rev === REV) {
          chunks.push(msg.series);
          if (statics !== null && msg.through === statics.lastIndex) {
            settled = true;
            try {
              resolve(viewOf(chunks, statics));
            } catch (e) {
              reject(new Error(`host error: view: ${messageOf(e)}`));
            }
          }
        }
        // `cells` and everything else: dropped on arrival
      };
      guard = setTimeout(
        () => fail(`window not filled in ${Math.round(timeoutMs / 1000)} s`),
        timeoutMs
      );
      host = createTimelineHost({
        fetch,
        fetchBytes,
        post,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        now: () => performance.now(),
        retryDelaysMs: [],
        warn
      });
      try {
        host.handle({
          type: 'openTimeline',
          rev: REV,
          manifest,
          policy,
          lots: {},
          months: WINDOW_MONTHS
        });
        host.handle({ type: 'prefetch', bbox: allBbox(manifest) });
      } catch (e) {
        fail(`host error: handle: ${messageOf(e)}`);
      }
    });
    return { datasetVersion: manifest.datasetVersion, asOf, view };
  } finally {
    (host as ReturnType<typeof createTimelineHost> | null)?.dispose();
    timers.close();
    if (guard !== null) clearTimeout(guard);
  }
}

/** Calendar months from `a`'s month to `b`'s. */
function monthsBetween(a: Day, b: Day): number {
  const ay = utcParts(a);
  const by = utcParts(b);
  return (by.y - ay.y) * 12 + (by.m - ay.m);
}

/** Read the goal over the run; `amount` defaults to the goal's own. */
export function readLevel2(run: EmptyRun, amount?: number): Level2Result {
  const { view } = run;
  const base = defaultGoal(run.asOf);
  const goal: Goal = amount === undefined ? base : { ...base, amount };
  const reading = readGoal(goal, view, view.lastIndex);
  if (reading === null) throw new Error('the window is not filled');
  const offset = monthsBetween(view.months[0], goal.deadline);
  const d = offset < 0 ? TODAY : Math.min(offset, view.lastIndex);
  const reachedOn = reading.reachedOn;
  return {
    datasetVersion: run.datasetVersion,
    amount: goal.amount,
    deadline: goal.deadline,
    reachedOn,
    homesAtDeadline: goal.measure.valueAt(view, d),
    marginMonths: reachedOn === null ? null : monthsBetween(reachedOn, goal.deadline)
  };
}

const count = (n: number) => n.toLocaleString('en-US');

/** The lines the command prints. */
export function level2Lines(r: Level2Result): string[] {
  const by = formatShortMonthYear(r.deadline);
  const short = count(r.amount - r.homesAtDeadline);
  const third =
    r.reachedOn === null
      ? `Missed: ${count(r.homesAtDeadline)} homes by ${by}, ${short} short`
      : `Reached: ${formatShortMonthYear(r.reachedOn)}, ${count(r.marginMonths!)} ` +
        `${r.marginMonths === 1 ? 'month' : 'months'} before the window's end`;
  return [`Dataset ${r.datasetVersion}`, `Goal: ${count(r.amount)} homes by ${by}`, third];
}

/** 0 when reached, 1 when missed. */
export function level2Exit(r: Level2Result): 0 | 1 {
  return r.reachedOn === null ? 1 : 0;
}

/** The command's arguments, or the reason they are refused. */
function parseArgs(argv: string[]): { dir: string; amount?: number } | { error: string } {
  let dir: string | null = null;
  let amount: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--amount') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) <= 0) {
        return { error: `--amount must be a positive integer, got ${v ?? 'nothing'}` };
      }
      amount = Number(v);
    } else if (a.startsWith('-')) {
      return { error: `unknown flag ${a}` };
    } else if (dir !== null) {
      return { error: `unexpected argument ${a}` };
    } else dir = a;
  }
  if (dir === null) {
    return { error: 'usage: npx tsx scripts/level2-check.ts <datasetDir> [--amount <homes>]' };
  }
  return amount === undefined ? { dir } : { dir, amount };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if ('error' in args) {
    console.error(`level2-check: ${args.error}`);
    return 2;
  }
  let run: EmptyRun;
  try {
    run = await runEmptyDocument(args.dir, { warn: (msg) => console.error(msg) });
  } catch (e) {
    console.error(`level2-check: ${messageOf(e)}`);
    return 2;
  }
  const r = readLevel2(run, args.amount);
  for (const line of level2Lines(r)) console.log(line);
  return level2Exit(r);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`level2-check: ${messageOf(e)}`);
      process.exitCode = 2;
    }
  );
}
