// `npx tsx scripts/reach-measure.ts <datasetDir> [--write] [--amount <homes>]`, or
// `--version <datasetVersion> [--from <origin>]` in place of the directory (tree-catalogue spec
// §sec-design-reach): runs the full tree through the timeline engine, reads when it reaches the
// goal and derives the ladder's years; `--write` rewrites src/lib/game/catalogue/ladder-years.ts.
// Exits 0 reached with a ladder, 1 missed or no earlier deadline, 2 when it could not run (one
// stderr line, `reach-measure: <reason>`, nothing on stdout).
//
// The engine runner (§sec-design-engine): one timeline host over a dataset directory or a
// published dataset version, filling the whole window for each policy document it is given, one
// document at a time. `scripts/tree-balance.ts` imports it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseManifest, type Manifest } from '../src/lib/data/manifest';
import type { ParcelId } from '../src/lib/data/parcel';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { utcParts } from '../src/lib/fzp/time';
import { fullTree } from '../src/lib/game/catalogue/play';
import { defaultGoal, readGoal, TODAY, type Goal } from '../src/lib/goal/goal';
import type { FetchLike } from '../src/lib/sim/chunks';
import { canonicalJson } from '../src/lib/sim-page/policy';
import { loadScenario, scenarioUrls, type FetchBytesLike } from '../src/lib/sim/scenario/load';
import type { BrushLotsResult } from '../src/lib/sim/scenario/types';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import type { TimelineHostRequest, TimelineHostResponse } from '../src/lib/sim/timeline-protocol';
import { createTimelineHost } from '../src/lib/sim/world/host';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import type { Calibration } from '../src/lib/timelapse/types';
import {
  EMPTY_LOG,
  logCompiled,
  logFilled,
  logRefill,
  nextMonth,
  viewOfLog,
  type ChunkLog
} from '../src/lib/timeline/chunk-log';
import { DEFAULT_POLICY4, queriesOf4, type SimPolicy4 } from '../src/lib/timeline/policy4';
import { reconcilePolicy4 } from '../src/lib/timeline/reconcile4';

export type DataSource = { dir: string } | { version: string; origin: string };

export const DEFAULT_ORIGIN = 'https://sfhousing.mindlace.net';

export interface Engine {
  datasetVersion: string;
  asOf: Day;
  cal: Calibration;
  /** The whole window's view for `doc`, reconciled and with its lots resolved. */
  view(doc: SimPolicy4): Promise<TimelineView>;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 600_000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Sources = { fetch: FetchLike; fetchBytes: FetchBytesLike };

/** Answers for one file's bytes: null serves a 404. */
function served(read: (url: string) => Promise<ArrayBuffer | null>): Sources {
  return {
    fetch: async (url) => {
      const b = await read(url);
      return b === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : {
            ok: true,
            status: 200,
            json: async () => JSON.parse(new TextDecoder().decode(b))
          };
    },
    fetchBytes: async (url) => {
      const b = await read(url);
      return b === null
        ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => b.slice(0) };
    }
  };
}

/** `<dir>/manifest.json`, parsed; rejects with `no dataset at {dir}`. */
function readManifest(dir: string): Manifest {
  try {
    return parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  } catch {
    throw new Error(`no dataset at ${dir}`);
  }
}

/** `/data/<datasetVersion>/<path>` served from `<dir>/<path>`; a missing file answers 404. */
function dirFetch(dir: string, manifest: Manifest): Sources {
  const prefix = `/data/${manifest.datasetVersion}/`;
  return served(async (url) => {
    if (!url.startsWith(prefix)) return null;
    try {
      const b = readFileSync(join(dir, url.slice(prefix.length)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  });
}

/**
 * `/data/<version>/<path>` fetched from `<origin>/data/<version>/<path>`, each file's bytes kept
 * for the life of the source; a failed fetch (a throw or an answer not ok) answers 404 and is not
 * kept.
 */
export function versionFetch(
  version: string,
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Sources {
  const base = origin.replace(/\/+$/, '');
  const prefix = `/data/${version}/`;
  const kept = new Map<string, Promise<ArrayBuffer | null>>();
  return served((url) => {
    if (!url.startsWith(prefix)) return Promise.resolve(null);
    let bytes = kept.get(url);
    if (bytes === undefined) {
      // A throw from the fetch or from reading the body is a failed fetch.
      bytes = fetchImpl(`${base}${url}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      kept.set(url, bytes);
      void bytes.then((b) => {
        if (b === null) kept.delete(url);
      });
    }
    return bytes;
  });
}

/** The manifest and the sources of a dataset source. */
async function openSource(src: DataSource): Promise<{ manifest: Manifest } & Sources> {
  if ('dir' in src) {
    const manifest = readManifest(src.dir);
    return { manifest, ...dirFetch(src.dir, manifest) };
  }
  const sources = versionFetch(src.version, src.origin);
  const missing = `no dataset ${src.version} at ${src.origin}`;
  const r = await sources.fetch(`/data/${src.version}/manifest.json`);
  if (!r.ok) throw new Error(missing);
  let manifest: Manifest;
  try {
    manifest = parseManifest(await r.json());
  } catch {
    throw new Error(missing);
  }
  if (manifest.datasetVersion !== src.version) {
    throw new Error(`the manifest of ${src.version} names ${manifest.datasetVersion}`);
  }
  return { manifest, ...sources };
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

/** The call being filled: its rev once sent (null while its lots resolve). */
interface Pending {
  rev: number | null;
  /** A `refill` at `rev` or later has come (the open owes none). */
  refilled: boolean;
  guard: ReturnType<typeof setTimeout>;
  resolve(view: TimelineView): void;
  reject(e: Error): void;
}

/**
 * Loads the dataset, opens one timeline host on the reconciled empty document at rev 1 and
 * resolves once its window is filled. Rejects with `no dataset at <dir>` (or
 * `no dataset <version> at <origin>`), `host error: <code>: <message>` or
 * `window not filled in <s> s`.
 */
export async function openEngine(
  src: DataSource,
  opts: {
    warn?: (msg: string) => void;
    timeoutMs?: number;
    /** Test seam: the host to drive (default `createTimelineHost`). */
    createHost?: typeof createTimelineHost;
  } = {}
): Promise<Engine> {
  const warn = opts.warn ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createHost = opts.createHost ?? createTimelineHost;
  const { manifest, fetch, fetchBytes } = await openSource(src);
  const timers = trackedTimers();

  const urls = scenarioUrls(manifest);
  if (urls === null) {
    timers.close();
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
  if (!('fzp' in loaded)) {
    timers.close();
    throw new Error(`host error: ${loaded.code}: ${loaded.message}`);
  }
  const { calibration: cal, asOf } = loaded.fzp;

  let log: ChunkLog = EMPTY_LOG;
  let pending: Pending | null = null;
  let closed = false;
  let rev = 0;
  let reqId = 0;
  const brushes = new Map<number, (r: BrushLotsResult) => void>();
  const views = new Map<string, TimelineView>();

  const settle = (p: Pending) => {
    clearTimeout(p.guard);
    brushes.clear();
    if (pending === p) pending = null;
  };
  const fail = (p: Pending | null, message: string) => {
    if (p === null || pending !== p) return;
    settle(p);
    p.reject(new Error(message));
  };
  const check = () => {
    const p = pending;
    if (p === null || p.rev === null || !p.refilled || log.statics === null) return;
    if (nextMonth(log) !== log.statics.lastIndex + 1) return;
    settle(p);
    try {
      p.resolve(viewOfLog(log)!);
    } catch (e) {
      p.reject(new Error(`host error: view: ${messageOf(e)}`));
    }
  };

  const post = (msg: TimelineHostResponse) => {
    if (closed) return;
    switch (msg.type) {
      case 'error': {
        // An error at a rev older than the pending call's is an abandoned call's (a timed-out
        // edit the pending one replaces): passed to `warn`, as is one with no call pending. While
        // the pending call resolves its lots it has no rev yet: every rev sent so far is older.
        const text = `host error: ${msg.code}: ${msg.message}`;
        const p = pending;
        if (p === null || msg.rev < (p.rev ?? rev + 1)) return warn(text);
        return fail(p, text);
      }
      case 'compiled':
        log = logCompiled(log, msg.statics);
        return check();
      case 'refill':
        log = logRefill(log, msg.from);
        if (pending !== null && pending.rev !== null && msg.rev >= pending.rev) {
          pending.refilled = true;
        }
        return check();
      case 'filled':
        log = logFilled(log, msg.series);
        return check();
      case 'brushLots': {
        const answer = brushes.get(msg.reqId);
        brushes.delete(msg.reqId);
        answer?.(msg.result);
        return;
      }
      default:
      // `cells`, `lookups`, `compiling` and everything else: dropped on arrival
    }
  };

  const host = createHost({
    fetch,
    fetchBytes,
    post,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => performance.now(),
    retryDelaysMs: [],
    warn
  });

  /** Sends `req`; a throw rejects the pending call. */
  const send = (req: TimelineHostRequest): boolean => {
    try {
      host.handle(req);
      return true;
    } catch (e) {
      fail(pending, `host error: handle: ${messageOf(e)}`);
      return false;
    }
  };

  /** A pending call with its guard running; the caller sends its requests. */
  const begin = (): Promise<TimelineView> =>
    new Promise<TimelineView>((resolve, reject) => {
      const p: Pending = {
        rev: null,
        refilled: false,
        resolve,
        reject,
        guard: setTimeout(
          () => fail(p, `window not filled in ${Math.round(timeoutMs / 1000)} s`),
          timeoutMs
        )
      };
      pending = p;
    });

  const close = () => {
    if (closed) return;
    const p = pending;
    if (p !== null) {
      settle(p);
      p.reject(new Error('engine closed'));
    }
    closed = true;
    host.dispose();
    timers.close();
  };

  const empty = reconcilePolicy4(DEFAULT_POLICY4, cal, asOf).doc;
  try {
    const opened = begin();
    const p = pending as Pending | null;
    rev = 1;
    p!.rev = rev;
    p!.refilled = true;
    if (
      send({ type: 'openTimeline', rev, manifest, policy: empty, lots: {}, months: WINDOW_MONTHS })
    ) {
      send({ type: 'prefetch', bbox: allBbox(manifest) });
    }
    views.set(canonicalJson(empty), await opened);
  } catch (e) {
    close();
    throw e;
  }

  /** Resolves the document's lots, sends it at the next rev and waits for the window. */
  const fill = async (policy: SimPolicy4): Promise<TimelineView> => {
    if (closed) throw new Error('engine closed');
    const filled = begin();
    const p = pending as Pending | null;
    const lots: Record<string, ParcelId[]> = {};
    for (const { key, query } of queriesOf4(policy)) {
      const id = ++reqId;
      const answer = new Promise<BrushLotsResult>((resolve) => brushes.set(id, resolve));
      if (!send({ type: 'resolveBrush', reqId: id, query })) return filled;
      const result = await Promise.race([
        answer,
        filled.then(
          () => null,
          () => null
        )
      ]);
      if (result === null || pending !== p) return filled;
      lots[key] = result.ok ? result.lots : [];
    }
    rev += 1;
    p!.rev = rev;
    send({ type: 'setPolicy', rev, policy, lots });
    return filled;
  };

  let queue: Promise<unknown> = Promise.resolve();
  const view = (doc: SimPolicy4): Promise<TimelineView> => {
    const run = queue.then(async () => {
      const policy = reconcilePolicy4(doc, cal, asOf).doc;
      const key = canonicalJson(policy);
      const kept = views.get(key);
      if (kept !== undefined) return kept;
      const v = await fill(policy);
      views.set(key, v);
      return v;
    });
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return { datasetVersion: manifest.datasetVersion, asOf, cal, view, close };
}

/**
 * The ladder's years (G6): from the largest multiple of five at least five years before the
 * window's end year down to the first multiple of five at or after the measured year; when more
 * than four fit, the first, the last and two evenly between.
 */
export function ladderYears(endYear: number, reachedYear: number): number[] {
  const first = 5 * Math.floor((endYear - 5) / 5);
  const last = 5 * Math.ceil(reachedYear / 5);
  const all: number[] = [];
  for (let y = first; y >= last; y -= 5) all.push(y);
  if (all.length <= 4) return all;
  const n = all.length - 1;
  return [0, Math.round(n / 3), Math.round((2 * n) / 3), n].map((i) => all[i]);
}

/** The text of ladder-years.ts. */
export function ladderFile(r: {
  datasetVersion: string;
  reachedOn: Day;
  deadline: Day;
  years: readonly number[];
}): string {
  return (
    "// The deadline years after the window's end, latest first (G6). Written by\n" +
    '// `npx tsx scripts/reach-measure.ts --write` on dataset ' +
    r.datasetVersion +
    ':\n' +
    '// the full tree reaches the goal in ' +
    formatShortMonthYear(r.reachedOn) +
    '; the window ends ' +
    formatShortMonthYear(r.deadline) +
    '.\n' +
    'export const LADDER_YEARS: readonly number[] = [' +
    r.years.join(', ') +
    '];\n'
  );
}

/** The ladder file of the repository this script is in, whatever the working directory. */
export const LADDER_FILE = fileURLToPath(
  new URL('../src/lib/game/catalogue/ladder-years.ts', import.meta.url)
);
const LADDER_FILE_SHOWN = 'src/lib/game/catalogue/ladder-years.ts';

/**
 * One dataset directory, or `--version <v>` with an optional `--from <origin>`, and the flags
 * named in `flags` (keys without their `--`: `{ write: 'bool', amount: 'value' }` takes `--write`
 * and `--amount <v>`); the flags given are returned under the same keys, a bool one as `true`.
 */
export function parseSourceArgs(
  argv: string[],
  flags: Record<string, 'bool' | 'value'>
): { src: DataSource; flags: Record<string, string | true> } | { error: string } {
  const kinds: Record<string, 'bool' | 'value'> = { ...flags, version: 'value', from: 'value' };
  const given: Record<string, string | true> = {};
  let dir: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      if (dir !== null) return { error: `unexpected argument ${a}` };
      dir = a;
      continue;
    }
    const name = a.startsWith('--') ? a.slice(2) : '';
    const kind = Object.hasOwn(kinds, name) ? kinds[name] : undefined;
    if (kind === undefined) return { error: `unknown flag ${a}` };
    if (Object.hasOwn(given, name)) return { error: `${a} given twice` };
    if (kind === 'bool') {
      given[name] = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    given[name] = v;
    i += 1;
  }
  const { version, from, ...rest } = given;
  if (from !== undefined && version === undefined) return { error: '--from needs --version' };
  if (version !== undefined && dir !== null) {
    return { error: `--version and a dataset directory (${dir}) are both given` };
  }
  if (typeof version === 'string') {
    return {
      src: { version, origin: typeof from === 'string' ? from : DEFAULT_ORIGIN },
      flags: rest
    };
  }
  if (dir === null) return { error: 'give a dataset directory or --version <datasetVersion>' };
  return { src: { dir }, flags: rest };
}

/** `--amount`'s value: a positive whole number, or undefined when not given. */
export function parseAmount(v: string | true | undefined): number | undefined | { error: string } {
  if (v === undefined) return undefined;
  if (v === true || !/^\d+$/.test(v) || Number(v) <= 0) {
    return { error: `--amount must be a positive integer, got ${v === true ? 'nothing' : v}` };
  }
  return Number(v);
}

/** The command's arguments, or the reason they are refused. */
export function parseReachArgs(
  argv: string[]
): { src: DataSource; write: boolean; amount?: number } | { error: string } {
  const parsed = parseSourceArgs(argv, { write: 'bool', amount: 'value' });
  if ('error' in parsed) return parsed;
  const amount = parseAmount(parsed.flags.amount);
  if (typeof amount === 'object') return amount;
  const write = parsed.flags.write === true;
  if (write && amount !== undefined) {
    return { error: '--write with --amount is refused: a test amount never sets the ladder' };
  }
  return amount === undefined ? { src: parsed.src, write } : { src: parsed.src, write, amount };
}

export interface Reach {
  datasetVersion: string;
  /** The reconciled full-tree document's policies, by kind. */
  policies: { total: number; zoning: number; permitting: number; money: number };
  /** The goal's deadline: the window's last whole calendar month. */
  deadline: Day;
  amount: number;
  /** Homes counted by the goal's measure at the deadline month. */
  homesAtDeadline: number;
  /** The first month the amount is met; null when it is not met by the deadline. */
  reachedOn: Day | null;
  /** `ladderYears` of the deadline's and the reach's years; null on a miss. */
  years: number[] | null;
}

/** Calendar months from `a`'s month to `b`'s. */
function monthsBetween(a: Day, b: Day): number {
  const ay = utcParts(a);
  const by = utcParts(b);
  return (by.y - ay.y) * 12 + (by.m - ay.m);
}

/** The full tree's reach of the goal; `amount` defaults to the goal's own. */
export async function measureReach(engine: Engine, amount?: number): Promise<Reach> {
  const tree = fullTree(engine.cal).doc;
  const { kinds } = reconcilePolicy4(tree, engine.cal, engine.asOf).doc;
  const view = await engine.view(tree);
  const base = defaultGoal(engine.asOf);
  const goal: Goal = amount === undefined ? base : { ...base, amount };
  const reading = readGoal(goal, view, view.lastIndex);
  if (reading === null) throw new Error('the window is not filled');
  const offset = monthsBetween(view.months[0], goal.deadline);
  const d = offset < 0 ? TODAY : Math.min(offset, view.lastIndex);
  const { reachedOn } = reading;
  return {
    datasetVersion: engine.datasetVersion,
    policies: {
      total: kinds.zoning.length + kinds.permitting.length + kinds.money.length,
      zoning: kinds.zoning.length,
      permitting: kinds.permitting.length,
      money: kinds.money.length
    },
    deadline: goal.deadline,
    amount: goal.amount,
    homesAtDeadline: goal.measure.valueAt(view, d),
    reachedOn,
    years: reachedOn === null ? null : ladderYears(utcParts(goal.deadline).y, utcParts(reachedOn).y)
  };
}

const count = (n: number) => n.toLocaleString('en-US');

/** The lines the command prints. */
export function reachLines(r: Reach): string[] {
  const p = r.policies;
  const lines = [
    `Dataset ${r.datasetVersion}`,
    `Full tree: ${count(p.total)} ${p.total === 1 ? 'policy' : 'policies'} ` +
      `(${p.zoning} zoning, ${p.permitting} permitting, ${p.money} money)`,
    `Window ends ${formatShortMonthYear(r.deadline)}`
  ];
  if (r.reachedOn === null) {
    lines.push(
      `Goal: ${count(r.amount)} homes, missed: ${count(r.homesAtDeadline)} homes by ` +
        formatShortMonthYear(r.deadline)
    );
    return lines;
  }
  lines.push(`Goal: ${count(r.amount)} homes, reached ${formatShortMonthYear(r.reachedOn)}`);
  if (r.years !== null && r.years.length > 0) {
    lines.push(`LADDER_YEARS = [${r.years.join(', ')}]`);
  } else {
    // ladderYears' first year, which the reach comes after
    const first = 5 * Math.floor((utcParts(r.deadline).y - 5) / 5);
    lines.push(`No earlier deadline: the full tree reaches the goal after Dec ${first}`);
  }
  return lines;
}

/** 0 when the goal is reached and the ladder holds a year, else 1. */
export function reachExit(r: Reach): 0 | 1 {
  return r.reachedOn !== null && r.years !== null && r.years.length > 0 ? 0 : 1;
}

/** The command after its arguments are parsed. */
export async function runReach(
  args: { src: DataSource; write: boolean; amount?: number },
  io: {
    open: typeof openEngine;
    out: (line: string) => void;
    err: (line: string) => void;
    writeFile: (path: string, text: string) => void;
  }
): Promise<0 | 1 | 2> {
  let r: Reach;
  try {
    const engine = await io.open(args.src, { warn: (msg) => io.err(msg) });
    try {
      r = await measureReach(engine, args.amount);
    } finally {
      engine.close();
    }
  } catch (e) {
    io.err(`reach-measure: ${messageOf(e)}`);
    return 2;
  }
  const code = reachExit(r);
  const lines = reachLines(r);
  if (args.write && code === 0) {
    // Written before anything is printed, so a failed write prints nothing on stdout.
    try {
      io.writeFile(
        LADDER_FILE,
        ladderFile({
          datasetVersion: r.datasetVersion,
          reachedOn: r.reachedOn!,
          deadline: r.deadline,
          years: r.years!
        })
      );
    } catch (e) {
      io.err(`reach-measure: ${messageOf(e)}`);
      return 2;
    }
    lines.push(`Wrote ${LADDER_FILE_SHOWN}`);
  }
  for (const line of lines) io.out(line);
  return code;
}

async function main(argv: string[]): Promise<number> {
  const args = parseReachArgs(argv);
  if ('error' in args) {
    console.error(`reach-measure: ${args.error}`);
    return 2;
  }
  return runReach(args, {
    open: openEngine,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    writeFile: (path, text) => writeFileSync(path, text)
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`reach-measure: ${messageOf(e)}`);
      process.exitCode = 2;
    }
  );
}
