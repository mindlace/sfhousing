// Wall-clock bars for the timeline host (`npm run test:perf`; never in signoff; ensemble-runner
// spec "test:perf", plan Task 8). Every number is printed; bars are asserted only here.
//
// - Bench city (always): no task of the host over 50 ms over a full fill and one edit, except the
//   accepted ones (a compile seam, policy-timeline.md "Known slice-bar risks"; the one cold
//   massing `ACCEPTED_MASSING`).
// - Live city (`SFH_WORLD_LIVE`, else the newest dataset under `pipeline/out/`), else the bench
//   city: first `cells` and first `filled` within 3 s of `openTimeline`; the whole-window fill
//   within 480 x 9 ms (live only); the longest task over a full fill and one edit, and what ran in
//   it; the warm-ahead before the first `cells`; `resyncMap` answers.
// - Heap: reported, not asserted against S16 (`HEAP_BOUND_MB`, null until the partner re-sets
//   it). The leak check is asserted: an edit that restores, then an edit back to the open's
//   document, each refilled, leave the heap within `LEAK_MARGIN` of the open and fill before them.
//
// Every task is timed through the host's own timer seam; what ran inside it is timed by
// pass-through wrappers on the modules the runner calls (vi.mock below), which add a clock read
// pair per call and change no result.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import { synthCity, synthPolicy } from '$lib/sim/scenario/fixtures/synth-city';
import { buildSimInput } from '$lib/sim/scenario/input';
import type { Loaded } from '$lib/sim/scenario/load';
import type { TimelineHostRequest, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import type { CustomBrush } from '$lib/sim-page/policy';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { Calibration } from '$lib/timelapse/types';
import { DEFAULT_POLICY4, queriesOf4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import { createTimelineHost, type TimelineHost } from './host';
import { monthFirstDay } from './months';
import { datasetFetch, mapFetch } from './runner/test/harness';
import { liveDir } from './test/cities.node';

/** S16's heap bound in MB over the loaded dataset: the partner re-sets it (measured 427/546 MB). */
export const HEAP_BOUND_MB: number | null = null;
/**
 * An edit that restores and an edit back to the open's document, each refilled, may leave the
 * heap this much above the open and fill before them: the larger of 30 MB and 10% of that fill's
 * delta. Back on the open's document the compiles in use match the open's, and the restores
 * replace worlds, series and copies one for one; what may stay is the generator memo's entries
 * for the edited zoning (an LRU, capped) and allocator slack. A leaked ensemble or copy set
 * (hundreds of MB) shows past it; one leaked zoning state (about 16 MB) would not, which the
 * 20-edit case's comparison with a fresh open of the same document reports.
 */
const LEAK_MARGIN = { mb: 30, share: 0.1 };
const SLICE_BAR_MS = 50;
const FIRST_BAR_MS = 3000;
const MONTH_BAR_MS = 9;
/** The one cold massing accepted over 50 ms (Task 1 measure, map-stream.md "Numbers"). */
const ACCEPTED_MASSING = 'CASE:2007.0946PRX:phase:3';
const WORLDS = 48;
const MONTHS = 480;
const LIVE = liveDir();

// ---------------------------------------------------------------- what ran in a task

const rec = vi.hoisted(() => {
  interface Part {
    label: string;
    ms: number;
    depth: number;
    detail?: string;
  }
  const state = {
    on: true,
    /** The parts of the task running now, or null outside a task. */
    parts: null as Part[] | null,
    /** Parts of 1 ms or more outside any task of the host (promise continuations). */
    loose: [] as (Part & { t: number })[],
    depth: 0,
    /** Every part, by label: count, sum, max. */
    totals: new Map<string, { n: number; sum: number; max: number }>(),
    /** Every call of these labels, in order. */
    watch: new Set(['cityInputAt', 'stream.snapshot', 'stream.rewind']),
    calls: [] as (Part & { t: number })[]
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Fn = (...a: any[]) => any;
  function wrap<F extends Fn>(label: string, fn: F, detail?: (...a: Parameters<F>) => string): F {
    return function (this: unknown, ...a: Parameters<F>) {
      if (!state.on) return fn.apply(this, a);
      const d = state.depth++;
      const t = performance.now();
      try {
        return fn.apply(this, a);
      } finally {
        state.depth--;
        const ms = performance.now() - t;
        const p: Part = { label, ms, depth: d, detail: detail?.(...a) };
        if (state.parts) state.parts.push(p);
        else if (ms >= 1) state.loose.push({ ...p, t });
        if (state.watch.has(label)) state.calls.push({ ...p, t });
        const tot = state.totals.get(label) ?? { n: 0, sum: 0, max: 0 };
        tot.n++;
        tot.sum += ms;
        tot.max = Math.max(tot.max, ms);
        state.totals.set(label, tot);
      }
    } as F;
  }
  /** Replaces `obj[key]` (a method) with a wrapped one. */
  function method(obj: Record<string, unknown>, key: string, label: string): void {
    const f = obj[key] as Fn;
    obj[key] = wrap(label, f.bind(obj));
  }
  /** The model months copied after (the runner's `COPY_MONTHS`, mutable here). */
  const copyMonths: number[] = [0];
  return { state, wrap, method, copyMonths };
});

vi.mock('./runner/ensemble', async (orig) => {
  const m = await orig<typeof import('./runner/ensemble')>();
  return {
    ...m,
    COPY_MONTHS: rec.copyMonths,
    createEnsemble(o: Parameters<typeof m.createEnsemble>[0]) {
      const e = m.createEnsemble(o);
      const unit = e.unit.bind(e);
      const units = new Map<string, () => void>();
      (e as { unit: () => void }).unit = () => {
        const kind = e.next() ?? 'none';
        let f = units.get(kind);
        if (!f) units.set(kind, (f = rec.wrap(`unit:${kind}`, unit)));
        f();
      };
      rec.method(e as unknown as Record<string, unknown>, 'setStatics', 'setStatics');
      return e;
    }
  };
});
vi.mock('./world', async (orig) => {
  const m = await orig<typeof import('./world')>();
  return {
    ...m,
    withFunding(f: Parameters<typeof m.withFunding>[0]) {
      const core = m.withFunding(f);
      return {
        ...core,
        planDue: rec.wrap('planDue', core.planDue),
        createWorld: rec.wrap('createWorld', core.createWorld)
      };
    }
  };
});
vi.mock('./score', async (orig) => {
  const m = await orig<typeof import('./score')>();
  return {
    ...m,
    chunkOf: rec.wrap('chunkOf', m.chunkOf),
    scoreStaticsOf: rec.wrap('scoreStaticsOf', m.scoreStaticsOf)
  };
});
vi.mock('./score/statics', async (orig) => {
  const m = await orig<typeof import('./score/statics')>();
  return { ...m, finalTable: rec.wrap('finalTable', m.finalTable) };
});
vi.mock('./policy/compile', async (orig) => {
  const m = await orig<typeof import('./policy/compile')>();
  return {
    ...m,
    compileTimeline: rec.wrap(
      'compileTimeline()',
      (...a: Parameters<typeof m.compileTimeline>) => {
        const c = m.compileTimeline(...a);
        rec.method(c as unknown as Record<string, unknown>, 'step', 'compile.step');
        return c;
      },
      (_d, _l, _c, base) => base
    )
  };
});
vi.mock('./policy/limits', async (orig) => {
  const m = await orig<typeof import('./policy/limits')>();
  return { ...m, cityInputAt: rec.wrap('cityInputAt', m.cityInputAt, (f) => `frame ${f.id}`) };
});
vi.mock('./policy/lookups', async (orig) => {
  const m = await orig<typeof import('./policy/lookups')>();
  return { ...m, lookupsAt: rec.wrap('lookupsAt', m.lookupsAt) };
});
vi.mock('./map-stream', async (orig) => {
  const m = await orig<typeof import('./map-stream')>();
  return {
    ...m,
    createMapStream(...a: Parameters<typeof m.createMapStream>) {
      const s = m.createMapStream(...a);
      const o = s as unknown as Record<string, unknown>;
      for (const k of ['flush', 'rewind', 'snapshot', 'cellsFor']) rec.method(o, k, `stream.${k}`);
      return s;
    }
  };
});
vi.mock('$lib/sim/scenario/massing', async (orig) => {
  const m = await orig<typeof import('$lib/sim/scenario/massing')>();
  return {
    ...m,
    massingFor: rec.wrap('massingFor', m.massingFor, (s, k) => `${s.projectId}:${k}`)
  };
});
vi.mock('$lib/sim/scenario/input', async (orig) => {
  const m = await orig<typeof import('$lib/sim/scenario/input')>();
  return { ...m, precomputeOf: rec.wrap('precomputeOf', m.precomputeOf) };
});
vi.mock('$lib/sim/levers/apply', async (orig) => {
  const m = await orig<typeof import('$lib/sim/levers/apply')>();
  return {
    ...m,
    applyLevers: rec.wrap('applyLevers', m.applyLevers),
    twinInput: rec.wrap('twinInput', m.twinInput)
  };
});
vi.mock('$lib/sim/levers/brushes', async (orig) => {
  const m = await orig<typeof import('$lib/sim/levers/brushes')>();
  return { ...m, resolveBrushRows: rec.wrap('resolveBrushRows', m.resolveBrushRows) };
});
vi.mock('$lib/map/height/city', async (orig) => {
  const m = await orig<typeof import('$lib/map/height/city')>();
  return {
    ...m,
    createCityBuild(...a: Parameters<typeof m.createCityBuild>) {
      const b = m.createCityBuild(...a);
      rec.method(b as unknown as Record<string, unknown>, 'step', 'city.step');
      return b;
    }
  };
});

// ---------------------------------------------------------------- helpers

setFlagsFromString('--expose-gc');
const gc =
  (globalThis as { gc?: () => void }).gc ?? (runInNewContext('gc') as (() => void) | undefined);

const r1 = (x: number) => Math.round(x * 10) / 10;
const MB = (b: number) => r1(b / 1048576);
const ms = (x: number) => `${r1(x)} ms`;
const log = (s: string) => console.log(`[perf host] ${s}`);

/** heapUsed plus the typed arrays' backing stores, after two collections (measure-1.md §2). */
function heap(): { heap: number; buffers: number; total: number } {
  gc?.();
  gc?.();
  const m = process.memoryUsage();
  return {
    heap: MB(m.heapUsed),
    buffers: MB(m.arrayBuffers),
    total: MB(m.heapUsed + m.arrayBuffers)
  };
}
const delta = (a: ReturnType<typeof heap>, b: ReturnType<typeof heap>) =>
  `heap +${r1(a.heap - b.heap)} / buffers +${r1(a.buffers - b.buffers)} / total +${r1(a.total - b.total)} MB`;

type Part = NonNullable<typeof rec.state.parts>[number];
type TaskKind = 'slice' | 'flush' | 'warm' | 'map' | 'request' | 'idle';

interface TaskRec {
  label: string;
  start: number;
  ms: number;
  kind: TaskKind;
  /** Only for tasks of 20 ms or more. */
  parts: Part[] | null;
  compileMs: number;
  /** Ensemble units run at its top level. */
  units: number;
}

interface Post {
  t: number;
  type: TimelineHostResponse['type'];
  rev?: number;
  through?: number;
  from?: number;
  lastIndex?: number;
  cells?: number;
  complete?: boolean;
  lots?: ParcelId[];
  reqId?: number;
  message?: string;
}

function kindOf(label: string, parts: Part[]): TaskKind {
  if (label !== 'timer') return 'request';
  const top = new Set(parts.filter((p) => p.depth === 0).map((p) => p.label));
  if (top.size === 0) return 'idle';
  if (top.has('stream.flush')) return 'flush';
  if (top.has('stream.rewind') || top.has('stream.snapshot')) return 'map';
  if ([...top].every((l) => l === 'massingFor')) return 'warm';
  return 'slice';
}

function summary(msg: TimelineHostResponse): Omit<Post, 't'> {
  switch (msg.type) {
    case 'filled':
      return { type: msg.type, rev: msg.rev, through: msg.through };
    case 'refill':
      return { type: msg.type, rev: msg.rev, from: msg.from };
    case 'compiled':
      return { type: msg.type, rev: msg.rev, lastIndex: msg.statics.lastIndex };
    case 'cells':
      return { type: msg.type, cells: msg.render.cells.length, complete: msg.render.complete };
    case 'brushLots':
      return { type: msg.type, reqId: msg.reqId, lots: msg.result.ok ? msg.result.lots : [] };
    case 'error':
      return { type: msg.type, rev: msg.rev, message: `${msg.code}: ${msg.message}` };
    default:
      return { type: msg.type };
  }
}

interface City {
  name: string;
  manifest: Manifest;
  fetch: ReturnType<typeof datasetFetch>['fetch'];
  fetchBytes: ReturnType<typeof datasetFetch>['fetchBytes'];
  load?: () => Promise<Loaded>;
  calibration: Calibration;
  asOf: Day;
  /** A point well inside the city, [lng, lat]. */
  centre: [number, number];
}

function liveCity(dir: string): City {
  const f = datasetFetch(dir);
  const read = (url: string) =>
    JSON.parse(
      readFileSync(join(dir, url.slice(`/data/${f.manifest.datasetVersion}/`.length)), 'utf8')
    );
  const fzp = f.manifest.scenarios!.fzp!;
  const calibration = parseCalibration(read(fzp.calibration));
  const asOf = parseProjectsFile(read(fzp.projects)).asOf;
  return {
    name: `live ${f.manifest.datasetVersion} (baseline money)`,
    manifest: f.manifest,
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    calibration,
    asOf,
    centre: [-122.42, 37.765]
  };
}

let bench: City | null = null;
/** The bench city (`synthCity`, as `benchInput()` and `benchRecords()` build it), no money. */
function benchCity(): City {
  if (bench) return bench;
  const city = synthCity();
  const projects = parseProjectsFile(structuredClone(city.projects));
  const calibration = parseCalibration(structuredClone(city.calibration));
  const { finance: _f, ...input } = buildSimInput({ parcels: city.parcels, projects, calibration });
  void _f;
  const policy = synthPolicy(city);
  const f = mapFetch(city.files.json);
  bench = {
    name: 'bench (synthCity, no money)',
    manifest: city.manifest,
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    load: async () => ({ fzp: input, twin: input, projects, policy, gross: null }),
    calibration,
    asOf: input.asOf,
    centre: [-122.435, 37.76]
  };
  return bench;
}

function bboxOf(m: Manifest): [number, number, number, number] {
  const b = m.chunks.map((c) => c.bbox);
  return [
    Math.min(...b.map((x) => x[0])),
    Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])),
    Math.max(...b.map((x) => x[3]))
  ];
}

const reconciled = (doc: SimPolicy4, c: City) => reconcilePolicy4(doc, c.calibration, c.asOf).doc;

function withZoning(...ps: Policy[]): SimPolicy4 {
  const doc = structuredClone(DEFAULT_POLICY4);
  doc.kinds.zoning.push(...ps);
  return doc;
}

const paintBrush = (k: number, at: [number, number]): CustomBrush => ({
  id: `p${k}`,
  kind: 'paint',
  strokes: [{ path: [at], radiusM: 120 }],
  stories: 12
});

const painted = (c: City, k: number, brush: CustomBrush, month: number): Policy => ({
  id: `painted-${k}`,
  label: `painted ${k}`,
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [
    { from: monthFirstDay(c.asOf, month), to: null, what: { tag: 'brushes', brushes: [brush] } }
  ]
});

const metro = (c: City, month: number): Policy => ({
  id: 'metro',
  label: 'metro',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [
    {
      from: monthFirstDay(c.asOf, month),
      to: null,
      what: {
        tag: 'bands',
        bands: [
          { maxM: 402, stories: 6 },
          { maxM: 805, stories: 4 }
        ]
      }
    }
  ]
});

// ---------------------------------------------------------------- the host, on a real clock

function hostOn(c: City) {
  const posts: Post[] = [];
  const tasks: TaskRec[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let reqId = 0;
  let rev = 0;
  function task(label: string, fn: () => void): void {
    const parts: Part[] = [];
    rec.state.parts = parts;
    rec.state.depth = 0;
    const start = performance.now();
    try {
      fn();
    } finally {
      const dt = performance.now() - start;
      rec.state.parts = null;
      if (rec.state.on) {
        let compileMs = 0;
        let units = 0;
        for (const p of parts) {
          if (p.depth !== 0) continue;
          if (p.label === 'compile.step') compileMs += p.ms;
          if (p.label.startsWith('unit:')) units++;
        }
        tasks.push({
          label,
          start,
          ms: dt,
          kind: kindOf(label, parts),
          parts: dt >= 20 ? parts : null,
          compileMs,
          units
        });
      }
    }
  }
  const host: TimelineHost = createTimelineHost({
    fetch: c.fetch,
    fetchBytes: c.fetchBytes,
    load: c.load,
    post: (msg) => posts.push({ t: performance.now(), ...summary(msg) }),
    setTimeout: (fn, delay) => {
      const h = setTimeout(() => {
        timers.delete(h);
        task('timer', fn);
      }, delay);
      timers.add(h);
      return h;
    },
    clearTimeout: (h) => {
      timers.delete(h as ReturnType<typeof setTimeout>);
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
    now: () => performance.now(),
    retryDelaysMs: [],
    warn: () => {}
  });
  const handle = (req: TimelineHostRequest) => task(`handle:${req.type}`, () => host.handle(req));
  const of = (type: Post['type'], r?: number) =>
    posts.filter((p) => p.type === type && (r === undefined || p.rev === r));
  async function until(pred: () => boolean, what: string, maxMs = 300_000): Promise<void> {
    const t0 = performance.now();
    while (!pred()) {
      if (performance.now() - t0 > maxMs) throw new Error(`timed out waiting for ${what}`);
      const err = posts.find((p) => p.type === 'error');
      if (err) throw new Error(`host error while waiting for ${what}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  /** The host has no timer left: its work for `r` is done (compiled, filled, drained). */
  async function settled(r: number): Promise<void> {
    const idle = () => of('compiled', r).length > 0 && timers.size === 0;
    for (let k = 0; k < 3; k++) {
      await until(idle, `rev ${r} to settle`);
      await new Promise((res) => setImmediate(res));
    }
    const last = of('compiled', r).at(-1)!.lastIndex!;
    const filled = of('filled').at(-1);
    expect(filled?.through).toBe(last);
    expect(of('cells').at(-1)?.complete).toBe(true);
  }
  function open(
    worlds: number,
    months: number,
    policy: SimPolicy4 = reconciled(DEFAULT_POLICY4, c),
    lots: Record<string, ParcelId[]> = {}
  ): { rev: number; t0: number } {
    rev++;
    const t0 = performance.now();
    handle({ type: 'openTimeline', rev, manifest: c.manifest, policy, lots, worlds, months });
    handle({ type: 'prefetch', bbox: bboxOf(c.manifest) });
    return { rev, t0 };
  }
  async function lotsOf(doc: SimPolicy4): Promise<Record<string, ParcelId[]>> {
    const lots: Record<string, ParcelId[]> = {};
    for (const { key, query } of queriesOf4(doc)) {
      const id = ++reqId;
      handle({ type: 'resolveBrush', reqId: id, query });
      await until(() => posts.some((p) => p.type === 'brushLots' && p.reqId === id), 'brush lots');
      lots[key] = posts.find((p) => p.type === 'brushLots' && p.reqId === id)!.lots!;
    }
    return lots;
  }
  async function edit(doc: SimPolicy4) {
    const lots = await lotsOf(doc);
    rev++;
    const t0 = performance.now();
    handle({ type: 'setPolicy', rev, policy: doc, lots });
    return { rev, t0, lots, count: Object.values(lots).reduce((n, l) => n + l.length, 0) };
  }
  return { host, posts, tasks, handle, of, until, settled, open, edit, lotsOf };
}

// ---------------------------------------------------------------- reading the tasks

/**
 * A task over the bar is accepted when the accepted items explain it: the one cold massing over
 * the bar (its time), and a compile step's overrun past its 20 ms budget (a compile seam). Only
 * those items' time is excused. Every top-level unit, less the accepted items inside it, must
 * still fit the bar, and so must the task as a whole; any other cold massing over the bar misses.
 */
function verdict(t: TaskRec): string {
  const parts = t.parts ?? [];
  const accepted = (p: Part) =>
    p.label === 'massingFor' &&
    p.ms > SLICE_BAR_MS &&
    p.detail?.startsWith(`${ACCEPTED_MASSING}:`) === true;
  const cold = parts.filter((p) => p.label === 'massingFor' && p.ms > SLICE_BAR_MS);
  const badCold = cold.filter((p) => !accepted(p));
  if (badCold.length > 0) return `MISS: cold massing ${badCold.map((p) => p.detail).join(', ')}`;
  // Parts are recorded as they end, so a top-level part follows the nested parts it holds.
  let inside: Part[] = [];
  let excused = 0;
  const reasons = new Set<string>();
  const overUnits: string[] = [];
  for (const p of parts) {
    if (p.depth > 0) {
      inside.push(p);
      continue;
    }
    let mine = 0;
    for (const q of [p, ...inside]) {
      if (!accepted(q)) continue;
      mine += q.ms;
      reasons.add('cold massing');
    }
    const seam = p.label === 'compile.step' ? Math.max(0, p.ms - 20) : 0;
    if (seam > 0) reasons.add('compile seam');
    excused += mine + seam;
    const rest = p.ms - mine - seam;
    if (rest > SLICE_BAR_MS) overUnits.push(`${p.label} ${r1(rest)}`);
    inside = [];
  }
  if (overUnits.length > 0) return `MISS: unit over the bar ${overUnits.join(', ')}`;
  if (excused > 0 && t.ms - excused <= SLICE_BAR_MS) {
    return `accepted: ${[...reasons].join(' and ')}`;
  }
  return 'MISS';
}

function breakdown(t: TaskRec): string {
  const top = new Map<string, { n: number; ms: number }>();
  const nested = new Map<string, { n: number; ms: number }>();
  for (const p of t.parts ?? []) {
    const m = p.depth === 0 ? top : nested;
    const e = m.get(p.label) ?? { n: 0, ms: 0 };
    e.n++;
    e.ms += p.ms;
    m.set(p.label, e);
  }
  const fmt = (m: typeof top) =>
    [...m]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 8)
      .map(([l, e]) => `${l} x${e.n} ${r1(e.ms)}`)
      .join(', ');
  const big = (t.parts ?? [])
    .filter((p) => p.ms >= 10)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map((p) => `${p.label}${p.detail ? ` (${p.detail})` : ''} ${r1(p.ms)}`)
    .join(', ');
  return `top: ${fmt(top)}; inside: ${fmt(nested) || '-'}; largest calls: ${big || '-'}`;
}

function report(name: string, tasks: TaskRec[]): { max: number; maxOfMisses: number } {
  const over = tasks.filter((t) => t.ms > SLICE_BAR_MS).sort((a, b) => b.ms - a.ms);
  const longest = [...tasks].sort((a, b) => b.ms - a.ms)[0];
  log(
    `${name}: ${tasks.length} tasks, longest ${ms(longest.ms)} (${longest.label}, ${longest.kind})`
  );
  log(`${name}: longest task: ${breakdown(longest)}`);
  const byKind = new Map<TaskKind, number[]>();
  for (const t of tasks) (byKind.get(t.kind) ?? byKind.set(t.kind, []).get(t.kind)!).push(t.ms);
  for (const [k, xs] of byKind) {
    const s = [...xs].sort((a, b) => a - b);
    log(
      `${name}: ${k} tasks ${s.length}: median ${ms(s[Math.floor(s.length / 2)])}, ` +
        `p90 ${ms(s[Math.floor(s.length * 0.9)])}, max ${ms(s[s.length - 1])}`
    );
  }
  let maxOfMisses = 0;
  for (const t of over) {
    const v = verdict(t);
    if (v.startsWith('MISS')) maxOfMisses = Math.max(maxOfMisses, t.ms);
    log(
      `${name}: over ${SLICE_BAR_MS} ms: ${ms(t.ms)} ${t.label}/${t.kind}: ${v}; ${breakdown(t)}`
    );
  }
  if (over.length === 0) log(`${name}: no task over ${SLICE_BAR_MS} ms`);
  return { max: longest.ms, maxOfMisses };
}

function totals(name: string, labels: string[]): void {
  for (const l of labels) {
    const t = rec.state.totals.get(l);
    if (t) log(`${name}: ${l}: ${t.n} calls, sum ${ms(t.sum)}, max ${ms(t.max)}`);
  }
}

// ---------------------------------------------------------------- a full fill and one edit

interface FillRun {
  city: City;
  tasks: TaskRec[];
  firstCells: number;
  firstFilled: number;
  fill: { wall: number; compile: number; net: number };
  max: number;
  maxOfMisses: number;
}

const runs = new Map<string, Promise<FillRun>>();

/** Opens `c`, fills it to the end, answers a `resyncMap`, applies one edit and refills. */
function fillRun(c: City, editDoc: (c: City) => SimPolicy4): Promise<FillRun> {
  let hit = runs.get(c.name);
  if (!hit) runs.set(c.name, (hit = doFillRun(c, editDoc)));
  return hit;
}

async function doFillRun(c: City, editDoc: (c: City) => SimPolicy4): Promise<FillRun> {
  rec.state.on = true;
  rec.state.totals.clear();
  rec.state.loose.length = 0;
  rec.state.calls.length = 0;
  rec.copyMonths.splice(0, rec.copyMonths.length, 0);
  const h = hostOn(c);
  const lag = monitorEventLoopDelay({ resolution: 5 });
  lag.enable();
  const o = h.open(WORLDS, MONTHS);
  await h.settled(o.rev);
  const cellsAt = h.posts.find((p) => p.type === 'cells' && (p.cells ?? 0) > 0)!.t;
  const filledAt = h.of('filled', o.rev)[0].t;
  const lastIndex = h.of('compiled', o.rev).at(-1)!.lastIndex!;
  const lastFilled = h.of('filled', o.rev).find((p) => p.through === lastIndex)!.t;
  log(
    `${c.name}: worlds ${WORLDS} + ${WORLDS}, months ${MONTHS}, copies after [${rec.copyMonths}]`
  );
  log(
    `${c.name}: first cells ${ms(cellsAt - o.t0)}, first filled ${ms(filledAt - o.t0)} after openTimeline`
  );

  // warm-ahead before the first cells (D12)
  const warm = h.tasks.filter((t) => t.kind === 'warm' && t.start < cellsAt);
  const warmSum = warm.reduce((n, t) => n + t.ms, 0);
  log(
    `${c.name}: warm tasks before the first cells: ${warm.length}, sum ${ms(warmSum)}, ` +
      `max ${ms(Math.max(0, ...warm.map((t) => t.ms)))}` +
      (warm.length > 0 ? `, first warm to first cells ${ms(cellsAt - warm[0].start)}` : '')
  );

  // whole-window fill: first unit to last filled, minus compile steps in between (load is before)
  const firstUnit = h.tasks.find((t) => t.units > 0)!;
  const inFill = h.tasks.filter((t) => t.start >= firstUnit.start && t.start <= lastFilled);
  const compile = inFill.reduce((n, t) => n + t.compileMs, 0);
  const wall = lastFilled - firstUnit.start;
  const fill = { wall, compile, net: wall - compile };
  const kinds = new Map<TaskKind, number>();
  for (const t of inFill) kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + t.ms);
  log(
    `${c.name}: fill from first unit to last filled ${ms(wall)}, compile steps in it ${ms(compile)}, ` +
      `net ${ms(fill.net)} (bar ${MONTHS} x ${MONTH_BAR_MS} = ${MONTHS * MONTH_BAR_MS} ms); ` +
      `per month ${ms(fill.net / MONTHS)}; time in tasks: ` +
      [...kinds].map(([k, v]) => `${k} ${r1(v)}`).join(', ') +
      `; between tasks ${ms(wall - [...kinds.values()].reduce((a, b) => a + b, 0))}`
  );

  // resyncMap after the fill (warm memo)
  const n0 = h.tasks.length;
  h.handle({ type: 'resyncMap' });
  log(`${c.name}: resyncMap after the fill (warm): ${ms(h.tasks[n0].ms)}`);
  await h.settled(o.rev);

  // one edit: resolve its lots (a viewer request), then setPolicy and the refill
  const doc = reconciled(editDoc(c), c);
  const nBeforeEdit = h.tasks.length;
  const e = await h.edit(doc);
  const brushTasks = h.tasks.slice(nBeforeEdit).filter((t) => t.label === 'handle:resolveBrush');
  const loose = rec.state.loose.filter((p) => p.label === 'resolveBrushRows');
  log(
    `${c.name}: edit ${e.count} lots; resolveBrush requests ${brushTasks.map((t) => ms(t.ms)).join(', ')}; ` +
      `resolveBrushRows outside tasks ${loose.map((p) => ms(p.ms)).join(', ') || '-'}`
  );
  await h.settled(e.rev);
  const refill = h.of('refill', e.rev);
  log(
    `${c.name}: edit settled in ${ms(performance.now() - e.t0)}; refill from ${refill.map((p) => p.from).join(', ') || 'none'}`
  );
  const n1 = h.tasks.length;
  h.handle({ type: 'resyncMap' });
  log(`${c.name}: resyncMap after the edit: ${ms(h.tasks[n1].ms)}`);
  await h.settled(e.rev);
  lag.disable();

  const filling = h.tasks.filter(
    (t) =>
      t.label === 'timer' || t.label === 'handle:openTimeline' || t.label === 'handle:setPolicy'
  );
  const { max, maxOfMisses } = report(c.name, filling);
  totals(c.name, [
    'compileTimeline()',
    'compile.step',
    'precomputeOf',
    'applyLevers',
    'twinInput',
    'unit:create',
    'unit:step',
    'unit:feed',
    'unit:copy',
    'unit:restore',
    'unit:quiet',
    'planDue',
    'setStatics',
    'scoreStaticsOf',
    'finalTable',
    'chunkOf',
    'lookupsAt',
    'cityInputAt',
    'city.step',
    'stream.flush',
    'stream.rewind',
    'stream.snapshot',
    'stream.cellsFor',
    'massingFor'
  ]);
  for (const label of rec.state.watch) {
    const calls = rec.state.calls.filter((p) => p.label === label);
    log(
      `${c.name}: ${label} calls: ` +
        (calls.map((p) => `${p.detail ? `${p.detail} ` : ''}${ms(p.ms)}`).join(', ') || '-')
    );
  }
  const looseBig = rec.state.loose.filter((p) => p.depth === 0 && p.ms >= 10);
  log(
    `${c.name}: outside the host's tasks (promise continuations), calls of 10 ms or more: ` +
      (looseBig.map((p) => `${p.label} ${ms(p.ms)}`).join(', ') || '-')
  );
  log(
    `${c.name}: event loop delay max ${ms(lag.max / 1e6)} (the whole process, test harness included)`
  );
  h.host.dispose();
  return {
    city: c,
    tasks: filling,
    firstCells: cellsAt - o.t0,
    firstFilled: filledAt - o.t0,
    fill,
    max,
    maxOfMisses
  };
}

const benchEdit = (c: City) => withZoning(painted(c, 0, paintBrush(0, c.centre), 120));
const liveEdit = (c: City) => withZoning(metro(c, 120));
const liveCityOnce = (() => {
  let c: City | null = null;
  return () => (c ??= liveCity(LIVE!));
})();
/** The live city when present, else the bench city. */
const primary = () => (LIVE ? fillRun(liveCityOnce(), liveEdit) : fillRun(benchCity(), benchEdit));

// ---------------------------------------------------------------- cases

describe('timeline host timings', () => {
  it('no slice over 50 ms on the bench city', { timeout: 600_000 }, async () => {
    const r = await fillRun(benchCity(), benchEdit);
    log(
      `bench: longest task ${ms(r.max)}; longest not accepted ${ms(r.maxOfMisses)} (bar ${SLICE_BAR_MS})`
    );
    expect(r.maxOfMisses).toBeLessThanOrEqual(SLICE_BAR_MS);
  });

  it('first cells and first filled within 3 s of openTimeline', { timeout: 600_000 }, async () => {
    const r = await primary();
    log(
      `${r.city.name}: first cells ${ms(r.firstCells)}, first filled ${ms(r.firstFilled)} ` +
        `(bar ${FIRST_BAR_MS} ms)`
    );
    expect(r.firstCells).toBeLessThanOrEqual(FIRST_BAR_MS);
    expect(r.firstFilled).toBeLessThanOrEqual(FIRST_BAR_MS);
  });

  it.skipIf(LIVE === null)(
    'whole-window fill on the live city within 480 x 9 ms',
    { timeout: 600_000 },
    async () => {
      const r = await primary();
      expect(r.fill.net).toBeLessThanOrEqual(MONTHS * MONTH_BAR_MS);
    }
  );

  it.skipIf(LIVE === null)(
    'the longest task over a full fill and one edit on the live city (reported)',
    { timeout: 600_000 },
    async () => {
      const r = await primary();
      log(`${r.city.name}: longest task ${ms(r.max)}; longest not accepted ${ms(r.maxOfMisses)}`);
      expect(r.tasks.length).toBeGreaterThan(0);
    }
  );

  it(
    'heap after a full fill, with and without copies, and after 20 edits that each add a zoning policy',
    { timeout: 600_000 },
    async () => {
      const c = LIVE ? liveCityOnce() : benchCity();
      rec.state.on = false;
      try {
        const h = hostOn(c);
        // the loaded dataset: one world each, one month, every chunk, filled and drained
        const b = h.open(1, 1);
        await h.settled(b.rev);
        const base = heap();
        log(`${c.name}: baseline (dataset, chunks, compiles, 1 + 1 worlds): ${base.total} MB`);

        rec.copyMonths.splice(0, rec.copyMonths.length);
        const a = h.open(WORLDS, MONTHS);
        await h.settled(a.rev);
        const none = heap();
        log(`${c.name}: full fill, no copies: ${delta(none, base)}`);

        rec.copyMonths.splice(0, rec.copyMonths.length, 0);
        const f = h.open(WORLDS, MONTHS);
        await h.settled(f.rev);
        const filled = heap();
        log(`${c.name}: full fill, COPY_MONTHS [${rec.copyMonths}]: ${delta(filled, base)}`);

        // one edit that restores (a zoning policy from month 200), then its refill
        const p0 = painted(c, 0, paintBrush(0, c.centre), 200);
        const e = await h.edit(reconciled(withZoning(p0), c));
        await h.settled(e.rev);
        expect(h.of('refill', e.rev).length).toBe(1);
        const edited = heap();
        log(
          `${c.name}: after one edit (restore, +1 zoning state) and its refill: ${delta(edited, base)}; ` +
            `against the open and fill +${r1(edited.total - filled.total)} MB`
        );
        // the leak check: back to the open's document (a restore from month 200), then its refill.
        // The compiles in use then equal the open's, so what stays above it is what leaked.
        const back = await h.edit(reconciled(structuredClone(DEFAULT_POLICY4), c));
        await h.settled(back.rev);
        expect(h.of('refill', back.rev).length).toBe(1);
        const after = heap();
        const leak = after.total - filled.total;
        const margin = Math.max(LEAK_MARGIN.mb, LEAK_MARGIN.share * (filled.total - base.total));
        log(
          `${c.name}: after editing back (restore) and its refill: ${delta(after, base)}; ` +
            `against the open and fill ${leak >= 0 ? '+' : ''}${r1(leak)} MB (margin ${r1(margin)} MB)`
        );

        // 20 edits, each adding one more painted zoning policy, each refilled to the end
        const ps: Policy[] = [];
        let last: { doc: SimPolicy4; lots: Record<string, ParcelId[]> } | null = null;
        const t0 = performance.now();
        for (let k = 1; k <= 20; k++) {
          const at: [number, number] = [
            c.centre[0] - 0.045 + (k % 7) * 0.015,
            c.centre[1] - 0.02 + Math.floor(k / 7) * 0.015
          ];
          ps.push(painted(c, k, paintBrush(k, at), 100 + 10 * k));
          const doc = reconciled(withZoning(...ps), c);
          const ek = await h.edit(doc);
          await h.settled(ek.rev);
          last = { doc, lots: ek.lots };
        }
        const twenty = heap();
        log(
          `${c.name}: after 20 edits (${ms(performance.now() - t0)}): ${delta(twenty, base)}; ` +
            `against the open and fill +${r1(twenty.total - filled.total)} MB`
        );
        // the same document opened afresh: what the 20 edits hold beyond it
        const fresh = h.open(WORLDS, MONTHS, last!.doc, last!.lots);
        await h.settled(fresh.rev);
        const opened = heap();
        log(
          `${c.name}: the 20-policy document opened afresh and filled: ${delta(opened, base)}; ` +
            `the 20 edits held ${r1(twenty.total - opened.total)} MB more`
        );
        if (HEAP_BOUND_MB === null)
          log(`${c.name}: S16 bound not set (partner to re-set): not asserted`);
        else {
          expect(none.total - base.total).toBeLessThanOrEqual(HEAP_BOUND_MB);
          expect(filled.total - base.total).toBeLessThanOrEqual(HEAP_BOUND_MB);
          expect(twenty.total - base.total).toBeLessThanOrEqual(HEAP_BOUND_MB);
        }
        expect(leak).toBeLessThanOrEqual(margin);
        h.host.dispose();
      } finally {
        rec.state.on = true;
        rec.copyMonths.splice(0, rec.copyMonths.length, 0);
      }
    }
  );
});
