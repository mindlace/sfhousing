// `node --expose-gc node_modules/.bin/tsx scripts/ensemble-measure.ts --dir <datasetDir>
// --case <name> [--extra <dir>] [--no-gross] [--no-money] [--no-copies] [--variant market|zoning]
// [--runs 3] [--worlds 48] [--months 480]`: ensemble-runner's measurements before building (plan Task 1).
// A prototype of the runner's fill loop (spec rules 5 to 8 and S16) over the step engine on a
// local copy of a published dataset. Cases, one per process so each starts cold:
//   ensemble  create 96 worlds, fill both ensembles to `--months` (scoring and MapStream.onEvent
//             included), copies every 60 months kept, the heap, month 1's burst, the statics.
//   replan    a dated change at month 120 (`--variant market`: a market step; `zoning`: a metro
//             rule); each world's change month timed.
//   compile   compileTimeline of a metro rule and of 500 painted lots from month 1.
//   first     load to the first flushed cells and to the first final calendar month.
//   flush     world 1 alone, flushed at 20 ms after every month; `flush-warm` also warms every
//             massing ahead of the flush (plan D12) and lists the cold ones over 50 ms.
//   sizes     where a world's bytes go (serialized sizes by column), no timing.
//   resume    restore every world from the month 0 copy and replay `--at` months quietly.
// `--extra` names a directory holding the dataset's `transit.json` and `neighborhoods.geojson`
// when the dataset directory lacks them. Measurement only: nothing in the bundle imports it.
import { existsSync, readFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { serialize, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { parseManifest, type Manifest } from '../src/lib/data/manifest';
import type { ParcelId, ParcelRecord } from '../src/lib/data/parcel';
import {
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData
} from '../src/lib/sim/levers/brushes';
import {
  createTableRecompute,
  createYieldRecompute,
  type GrossCache,
  type YieldRecompute
} from '../src/lib/sim/levers/recompute';
import { decodeTransit } from '../src/lib/data/transit-codec';
import { loadScenario, scenarioUrls, type Loaded } from '../src/lib/sim/scenario/load';
import { massingFor } from '../src/lib/sim/scenario/massing';
import { precomputeOf } from '../src/lib/sim/scenario/input';
import type { LedgerEvent } from '../src/lib/sim/scenario/money';
import type { SimInput } from '../src/lib/sim/scenario/types';
import { customQuery, queryKey, type CustomBrush } from '../src/lib/sim-page/policy';
import {
  DEFAULT_POLICY4,
  queriesOf4,
  type Effect,
  type Policy,
  type Selector,
  type SimPolicy4
} from '../src/lib/timeline/policy4';
import { reconcilePolicy4 } from '../src/lib/timeline/reconcile4';
import { createFundingSystem } from '../src/lib/sim/world/funding';
import {
  createMapStream,
  type MapStream,
  type MapStreamDeps
} from '../src/lib/sim/world/map-stream';
import { monthFirstDay, monthLastDay } from '../src/lib/sim/world/months';
import { comparisonOf } from '../src/lib/sim/world/policy/compare';
import { compileTimeline, type CompileCtx } from '../src/lib/sim/world/policy/compile';
import type { PolicyTimeline } from '../src/lib/sim/world/policy/frame';
import { scheduleAt } from '../src/lib/sim/world/read';
import { chunkOf, createWorldSeries, scoreStaticsOf } from '../src/lib/sim/world/score';
import { finalTable } from '../src/lib/sim/world/score/statics';
import type {
  MoneyFeed,
  ScoreStatics,
  WorldSeries,
  WorldSeriesData
} from '../src/lib/sim/world/score/types';
import { staticsOf, type Statics } from '../src/lib/sim/world/statics';
import { dirRecords } from '../src/lib/sim/world/test/map-stream-cities.node.js';
import { streamDeps } from '../src/lib/sim/world/test/map-stream-deps';
import type { Due, StepSink, World, WorldEvent } from '../src/lib/sim/world/types';
import { withFunding } from '../src/lib/sim/world/world';

const now = () => performance.now();
// tsx runs the script in a child process, so `node --expose-gc` may not reach it
setFlagsFromString('--expose-gc');
const gc =
  (globalThis as { gc?: () => void }).gc ?? (runInNewContext('gc') as (() => void) | undefined);
const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i < 0 ? null : (argv[i + 1] ?? null);
};
const num = (name: string, dflt: number) => Number(opt(name) ?? dflt);
const has = (name: string) => argv.includes(name);

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const MB = (b: number) => r1(b / 2 ** 20);

/** Median, p90, max and count. */
function stats(xs: readonly number[], round = r3) {
  if (xs.length === 0) return { n: 0, median: 0, p90: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, median: round(at(0.5)), p90: round(at(0.9)), max: round(s[s.length - 1]) };
}

/**
 * After two gcs: the JS heap and the typed arrays' backing stores, which `heapUsed` leaves out
 * (a world is mostly typed arrays, and a `structuredClone` copies their buffers whole).
 */
function heapMb(): { heap: number; arrayBuffers: number; total: number } {
  gc?.();
  gc?.();
  const m = process.memoryUsage();
  return {
    heap: MB(m.heapUsed),
    arrayBuffers: MB(m.arrayBuffers),
    total: MB(m.heapUsed + m.arrayBuffers)
  };
}

const COPY_EVERY = 60;
/** The runner's flush budget (spec rule 9). */
const FLUSH_MS = 20;
/** The compile slice (spec rule 11). */
const COMPILE_MS = 20;
/** Cold massings listed above this. */
const SLOW_MASSING_MS = 50;

// ---------------------------------------------------------------- the dataset

interface Live {
  label: string;
  manifest: Manifest;
  loaded: Loaded;
  /** The FZP input as loaded: baseline money included when the calibration has it. */
  funded: SimInput;
  records: ParcelRecord[];
  byId: Map<ParcelId, ParcelRecord>;
  brushData(): BrushData;
  loadMs: number;
}

async function loadLive(dir: string, extra: string | null): Promise<Live> {
  const t0 = now();
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  const prefix = `/data/${manifest.datasetVersion}/`;
  const pathOf = (url: string) => join(dir, url.slice(prefix.length));
  const urls = scenarioUrls(manifest);
  if (!urls?.policy) throw new Error(`no scenarios.fzp with policy.bin in ${dir}`);
  const loaded = await loadScenario(
    {
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(pathOf(url), 'utf8'))
      }),
      fetchBytes: async (url) => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const b = readFileSync(pathOf(url));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        }
      }),
      setTimeout: (fn, t) => setTimeout(fn, t),
      retryDelaysMs: [],
      warn: () => {}
    },
    urls,
    () => false,
    { policy: true }
  );
  if (!('fzp' in loaded)) throw new Error(`load failed: ${loaded.code}: ${loaded.message}`);
  const records = dirRecords(dir);
  const byId = new Map<ParcelId, ParcelRecord>();
  for (const r of records) byId.set(r.id, r);
  const loadMs = now() - t0;
  const fileOf = (url: string | undefined, name: string): string => {
    const own = url ? pathOf(url) : null;
    if (own && existsSync(own)) return own;
    if (extra && existsSync(join(extra, name))) return join(extra, name);
    throw new Error(`no ${name} in ${dir}; pass --extra <dir>`);
  };
  return {
    label: manifest.datasetVersion,
    manifest,
    loaded,
    funded: loaded.fzp,
    records,
    byId,
    loadMs,
    brushData: () => ({
      parcels: loaded.fzp.parcels,
      policy: loaded.policy!,
      transit: decodeTransit(
        JSON.parse(readFileSync(fileOf(manifest.transit, 'transit.json'), 'utf8'))
      ),
      neighborhoods: parseNeighborhoods(
        JSON.parse(readFileSync(fileOf(manifest.neighborhoods, 'neighborhoods.geojson'), 'utf8'))
      )
    })
  };
}

/** `input` without public money. */
function unfunded(input: SimInput): SimInput {
  const { finance: _finance, ...rest } = input;
  void _finance;
  return rest;
}

/** Recompute-step timings, filled by the `YieldSource` below. */
interface Seam {
  recompute: number[];
}

function yieldsOf(live: Live, noGross: boolean, seam: Seam | null): CompileCtx['yields'] {
  const gross = live.loaded.gross;
  const timed = (job: YieldRecompute): YieldRecompute => {
    if (!seam) return job;
    const inner = job.step.bind(job);
    return Object.assign(Object.create(job) as YieldRecompute, {
      step(budgetMs: number) {
        const t = now();
        const done = inner(budgetMs);
        seam.recompute.push(now() - t);
        return done;
      }
    });
  };
  return {
    recompute: (parcels, needs) =>
      timed(
        !noGross && gross
          ? createTableRecompute(parcels, needs, gross, { now })
          : createYieldRecompute(
              parcels,
              needs,
              { record: (id) => live.byId.get(id), cellLoaded: () => true, now },
              new Map() as GrossCache
            )
      ),
    failedCells: () => []
  };
}

function ctxOf(live: Live, input: SimInput, months: number, yields: CompileCtx['yields']) {
  const ctx: CompileCtx = {
    input,
    layers: { parcels: input.parcels, policy: live.loaded.policy! },
    windowMonths: months,
    yields,
    now
  };
  return ctx;
}

/** `doc` reconciled with the calibration and date the compile is given. */
const reconciled = (doc: SimPolicy4, input: SimInput) =>
  reconcilePolicy4(doc, input.calibration, input.asOf).doc;

interface Compiled {
  timeline: PolicyTimeline;
  firstMs: number;
  allMs: number;
  slices: number[];
}

/** Compiles to the end in `step(20)` slices, timing each. */
function compileFully(
  doc: SimPolicy4,
  lots: Record<string, ParcelId[]>,
  ctx: CompileCtx,
  base: 'plan' | 'preFzp'
): Compiled {
  const t0 = now();
  const c = compileTimeline(doc, lots, ctx, base);
  const slices: number[] = [];
  let firstMs = -1;
  for (let done = false; !done;) {
    const s = now();
    done = c.step(COMPILE_MS);
    slices.push(now() - s);
    if (firstMs < 0) {
      try {
        c.result();
        firstMs = now() - t0;
      } catch {
        // month 1 not built yet
      }
    }
  }
  return { timeline: c.result(), firstMs, allMs: now() - t0, slices };
}

const policyOf = (id: string, where: Selector, from: number, what: Effect): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans: [{ from, to: null, what }]
});
const docOf = (p: Policy): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning: [p], permitting: [], money: [] }
});

/** One metro rule (6 stories within 402 m, 4 within 805 m) from model month `month`. */
function metroDoc(live: Live, input: SimInput, month: number) {
  const doc = reconciled(
    docOf(
      policyOf(
        'metro',
        { tag: 'transit', stopTypes: ['metro'] },
        monthFirstDay(input.asOf, month),
        {
          tag: 'bands',
          bands: [
            { maxM: 402, stories: 6 },
            { maxM: 805, stories: 4 }
          ]
        }
      )
    ),
    input
  );
  const t = now();
  const data = live.brushData();
  const index = createLotIndex(input.parcels);
  const lots: Record<string, ParcelId[]> = {};
  for (const { key, query } of queriesOf4(doc)) {
    const rows = resolveBrushRows(data, index, query);
    lots[key] = [...new Set(rows.map((r) => input.parcels.id[r] as ParcelId))].sort();
  }
  return { doc, lots, resolveMs: now() - t };
}

/** The first 500 hostable lots (sorted ids) painted to 8 stories from month 1. */
function paintedDoc(input: SimInput) {
  const brush: CustomBrush = {
    id: 'b8',
    kind: 'paint',
    strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
    stories: 8
  };
  const doc = reconciled(
    docOf(
      policyOf('painted', { tag: 'painted' }, monthFirstDay(input.asOf, 1), {
        tag: 'brushes',
        brushes: [brush]
      })
    ),
    input
  );
  const ids = [...input.parcels.id.keys()]
    .filter((i) => input.parcels.hostable[i] === 1)
    .map((i) => input.parcels.id[i] as ParcelId)
    .sort()
    .slice(0, 500);
  return { doc, lots: { [queryKey(customQuery(brush))]: ids }, resolveMs: 0 };
}

// ---------------------------------------------------------------- the prototype runner

/** One world of an ensemble with its feed. */
interface Member {
  seed: number;
  world: World;
  due: Due;
  series: WorldSeries;
  /** This step's events, fed to the series (and world 1's stream) after the step. */
  buf: WorldEvent[];
  sink: StepSink;
}

interface Ensemble {
  name: 'plan' | 'comparison';
  timeline: PolicyTimeline;
  score: ScoreStatics;
  members: Member[];
}

interface Copy {
  month: number;
  worlds: World[][];
  feeds: WorldSeriesData[][];
  ledgerLength: number;
}

interface Session {
  input: SimInput;
  statics: Statics;
  money: boolean;
  core: ReturnType<typeof withFunding>;
  plan: Ensemble;
  comp: Ensemble;
  ledger: LedgerEvent[];
  stream: MapStream;
  deps: MapStreamDeps;
  /** createWorld + planDue, and planDue alone, per world. */
  createMs: number[];
  planMs: number[];
}

/** Both compiles, run to the end; `scoreStaticsOf` on each (plan D3). */
function compileBoth(live: Live, input: SimInput, doc: SimPolicy4, months: number) {
  const ctx = ctxOf(live, input, months, yieldsOf(live, false, null));
  const planDoc = reconciled(doc, input);
  const lots = Object.fromEntries(queriesOf4(planDoc).map((q) => [q.key, [] as ParcelId[]]));
  const plan = compileFully(planDoc, lots, ctx, 'plan');
  const c = comparisonOf(planDoc);
  const comp = compileFully(c.doc, {}, ctx, c.base);
  const rhna = live.loaded.projects.rhnaCompletedNet;
  const t = now();
  const planScore = scoreStaticsOf(input, plan.timeline, 'plan', months, rhna);
  const scoreMs = now() - t;
  const compScore = scoreStaticsOf(input, comp.timeline, c.base, months, rhna);
  return { plan, comp, compBase: c.base, planScore, compScore, scoreMs };
}

/**
 * Creates `worlds` worlds per ensemble (seeds 1..worlds), each `planDue` through `months`. World 1
 * of the plan gets the ledger and the map stream; `createWorld`'s events are buffered and fed once
 * it returns (map-stream.md, "Host calls").
 */
function createSession(
  input: SimInput,
  money: boolean,
  compiled: ReturnType<typeof compileBoth>,
  worlds: number,
  months: number,
  deps: MapStreamDeps,
  planThrough = months
): Session {
  const statics = staticsOf(input);
  const core = withFunding(money ? createFundingSystem() : null);
  const ledger: LedgerEvent[] = [];
  const stream = createMapStream(deps, months);
  const createMs: number[] = [];
  const planMs: number[] = [];
  const make = (
    name: Ensemble['name'],
    timeline: PolicyTimeline,
    score: ScoreStatics
  ): Ensemble => {
    const members: Member[] = [];
    for (let seed = 1; seed <= worlds; seed++) {
      const buf: WorldEvent[] = [];
      const sink: StepSink =
        name === 'plan' && seed === 1
          ? { event: (e) => buf.push(e), ledger: (e) => ledger.push(e) }
          : { event: (e) => buf.push(e) };
      const t = now();
      const world = core.createWorld(statics, timeline, seed, sink);
      const tp = now();
      const due = core.planDue(world, statics, timeline, seed, planThrough);
      planMs.push(now() - tp);
      createMs.push(now() - t);
      members.push({ seed, world, due, series: createWorldSeries(score), buf, sink });
    }
    return { name, timeline, score, members };
  };
  const plan = make('plan', compiled.plan.timeline, compiled.planScore);
  const comp = make('comparison', compiled.comp.timeline, compiled.compScore);
  const s: Session = {
    input,
    statics,
    money,
    core,
    plan,
    comp,
    ledger,
    stream,
    deps,
    createMs,
    planMs
  };
  // creation events: to the series, and world 1's to the stream
  for (const e of [plan, comp]) for (const m of e.members) feed(s, e, m, 0);
  return s;
}

/** Feeds a member's buffered events to its series (and world 1's to the stream); returns ms each. */
function feed(s: Session, e: Ensemble, m: Member, month: number): { score: number; map: number } {
  const t0 = now();
  for (const ev of m.buf) m.series.add(ev, m.world, s.statics);
  if (month > 0) m.series.stepped(month);
  const t1 = now();
  if (e.name === 'plan' && m.seed === 1)
    for (const ev of m.buf) s.stream.onEvent(ev, m.world, s.statics);
  const t2 = now();
  m.buf.length = 0;
  return { score: t1 - t0, map: t2 - t1 };
}

/** World 1's money feed (plan D9): null when finance is null or has no pools. */
function moneyFeedOf(s: Session, through: number): MoneyFeed | null {
  const f1 = s.plan.timeline.frameAt(1).finance;
  if (f1 === null || f1.pools.length === 0) return null;
  const m = finalTable(s.plan.score)[through];
  return {
    ledger: s.ledger,
    finance: s.plan.timeline.frameAt(m).finance!,
    world: s.plan.members[0].world,
    statics: s.statics
  };
}

interface Unit {
  step: number;
  score: number;
  map: number;
}

/** One unit (spec rule 5): one world advanced one model month, fed. */
function unit(s: Session, e: Ensemble, m: Member, month: number): Unit {
  const t = now();
  s.core.step(m.world, m.due, s.statics, e.timeline, m.seed, m.sink);
  const step = now() - t;
  const f = feed(s, e, m, month);
  return { step, score: f.score, map: f.map };
}

function takeCopy(s: Session): Copy {
  return {
    month: s.plan.members[0].world.month,
    worlds: [s.plan, s.comp].map((e) => e.members.map((m) => structuredClone(m.world))),
    feeds: [s.plan, s.comp].map((e) => e.members.map((m) => m.series.data())),
    ledgerLength: s.ledger.length
  };
}

// ---------------------------------------------------------------- cases

interface Common {
  live: Live;
  /** `--no-copies`: copies are taken (and timed) but not kept, to size the live set alone. */
  dropCopies: boolean;
  /** `--copies 0,240`: the model months copies are taken after (default every 60). */
  copyMonths: number[] | null;
  months: number;
  worlds: number;
  money: boolean;
  input: SimInput;
}

/** Cases 1 (create), 2 (heap), 3 (fill), 4 (burst), 9 (statics). */
function caseEnsemble(c: Common) {
  const heap0 = heapMb();
  const tc = now();
  const compiled = compileBoth(c.live, c.input, DEFAULT_POLICY4, c.months);
  const compileMs = now() - tc;
  const deps = streamDeps(c.input, c.live.records, { now });
  const heapBase = heapMb();

  const t0 = now();
  const s = createSession(c.input, c.money, compiled, c.worlds, c.months, deps);
  const createTotal = now() - t0;

  const copies: Copy[] = [];
  const copyMs: number[] = [];
  let t = now();
  const copyAt = (m: number) =>
    c.copyMonths === null ? m % COPY_EVERY === 0 : c.copyMonths.includes(m);
  if (copyAt(0)) {
    const copy0 = takeCopy(s);
    copyMs.push(now() - t);
    if (!c.dropCopies) copies.push(copy0);
  }

  const burst: Unit[] = [];
  const perMonth: number[] = [];
  const parts = { step: 0, score: 0, map: 0, chunk: 0 };
  const unitMax = { ms: 0, month: 0, ensemble: '', seed: 0 };
  let posted = -1;
  let filledPosts = 0;
  const fillStart = now();
  for (let month = 1; month <= c.months; month++) {
    let total = 0;
    for (const e of [s.plan, s.comp]) {
      for (const m of e.members) {
        const u = unit(s, e, m, month);
        const ms = u.step + u.score + u.map;
        total += ms;
        if (month === 1) burst.push(u);
        else {
          parts.step += u.step;
          parts.score += u.score;
          parts.map += u.map;
        }
        if (ms > unitMax.ms) Object.assign(unitMax, { ms, month, ensemble: e.name, seed: m.seed });
      }
    }
    // rule 8: post the calendar months that became final
    const through = Math.min(
      s.plan.members[0].series.finalThrough(),
      s.comp.members[0].series.finalThrough()
    );
    if (through > posted) {
      const tk = now();
      chunkOf(
        s.plan.members.map((m) => m.series),
        s.comp.members.map((m) => m.series),
        moneyFeedOf(s, through),
        posted + 1,
        through
      );
      const ck = now() - tk;
      total += ck;
      if (month > 1) parts.chunk += ck;
      posted = through;
      filledPosts++;
    }
    if (month > 1) perMonth.push(total);
    if (copyAt(month)) {
      t = now();
      const copy = takeCopy(s);
      copyMs.push(now() - t);
      if (!c.dropCopies) copies.push(copy);
    }
  }
  const fillMs = now() - fillStart;
  const copySum = copyMs.reduce((a, b) => a + b, 0);
  const fillOnly = perMonth.reduce((a, b) => a + b, 0);

  const heapBeforeDrain = heapMb();
  // drain the map (D5): its memos belong in the heap a filled worker holds
  const td = now();
  let drains = 0;
  for (let done = false; !done;) {
    const u = s.stream.flush(s.plan.members[0].world, s.statics, Infinity);
    drains++;
    done = u === null || u.complete === true;
  }
  const drainMs = now() - td;
  const heapFull = heapMb();

  // case 9: series re-created from data() (plan D2)
  const tr = now();
  for (const e of [s.plan, s.comp])
    for (const m of e.members) createWorldSeries(e.score, m.series.data());
  const recreateMs = now() - tr;
  const short = createShort(c, compiled);

  const months1 = c.months - 1;
  const parts1 = Object.fromEntries(
    Object.entries(parts).map(([k, v]) => [k, r3(v / months1)])
  ) as typeof parts;
  return {
    case: 'ensemble',
    money: c.money,
    worlds: `${c.worlds} + ${c.worlds}`,
    months: c.months,
    compileBothMs: r1(compileMs),
    create: {
      totalMs: r1(createTotal),
      perWorld: stats(s.createMs),
      planDueTotalMs: r1(s.planMs.reduce((a, b) => a + b, 0)),
      planDuePerWorld: stats(s.planMs),
      gate1500: createTotal > 1500 ? 'TRIPPED' : 'ok',
      ...short
    },
    heap: {
      beforeCompileMb: heap0,
      baselineMb: heapBase,
      filledBeforeMapDrainMb: heapBeforeDrain,
      filledWithCopiesMb: heapFull,
      deltaMb: {
        heap: r1(heapFull.heap - heapBase.heap),
        arrayBuffers: r1(heapFull.arrayBuffers - heapBase.arrayBuffers),
        total: r1(heapFull.total - heapBase.total)
      },
      copiesKept: copies.map((x) => x.month),
      ledgerEvents: s.ledger.length,
      gate300: heapFull.total - heapBase.total > 300 ? 'TRIPPED' : 'ok'
    },
    fill: {
      monthsTimed: `2..${c.months}`,
      perMonthAllWorlds: stats(perMonth),
      meanPerMonth: r3(fillOnly / months1),
      perComponentMeanPerMonth: parts1,
      worldMonthsPerSecond: Math.round((2 * c.worlds * months1) / (fillOnly / 1000)),
      against9ms: stats(perMonth).median <= 9 ? 'median within 9 ms' : 'median OVER 9 ms',
      monthsOver9ms: perMonth.filter((x) => x > 9).length,
      largestUnit: { ...unitMax, ms: r3(unitMax.ms) },
      filledPosts,
      wallMsIncludingCopies: r1(fillMs)
    },
    burst: {
      month1AllWorldsMs: r1(burst.reduce((a, u) => a + u.step + u.score + u.map, 0)),
      perUnit: stats(burst.map((u) => u.step + u.score + u.map)),
      stepOnly: stats(burst.map((u) => u.step))
    },
    copies: { perCopyMs: stats(copyMs, r1), totalMs: r1(copySum) },
    mapDrain: { ms: r1(drainMs), flushes: drains },
    statics: {
      scoreStaticsOfMs: r1(compiled.scoreMs),
      recreate96SeriesFromDataMs: r1(recreateMs)
    }
  };
}

/**
 * The gate's fallback (spec rule 4): 96 worlds created with `planDue` through 60 only, then, at
 * month 48, each world's due list re-planned through month 108 (one unit per world).
 */
function createShort(c: Common, compiled: ReturnType<typeof compileBoth>) {
  const PLAN_THROUGH = 60;
  const deps = streamDeps(c.input, c.live.records, { now });
  const t = now();
  const s = createSession(c.input, c.money, compiled, c.worlds, c.months, deps, PLAN_THROUGH);
  const total = now() - t;
  const at = PLAN_THROUGH - 12;
  for (let month = 1; month <= at; month++)
    for (const e of [s.plan, s.comp]) for (const m of e.members) unit(s, e, m, month);
  const ext: number[] = [];
  for (const e of [s.plan, s.comp])
    for (const m of e.members) {
      const t1 = now();
      m.due = s.core.planDue(m.world, s.statics, e.timeline, m.seed, at + PLAN_THROUGH);
      ext.push(now() - t1);
    }
  return {
    through60: {
      totalMs: r1(total),
      perWorld: stats(s.createMs),
      planDuePerWorld: stats(s.planMs),
      extendAt48Through108PerWorld: stats(ext),
      extendAllWorldsMs: r1(ext.reduce((a, b) => a + b, 0))
    }
  };
}

/** Case 5: a dated change at month 120; every world's change month, per ensemble. */
function caseReplan(c: Common, variant: 'market' | 'zoning') {
  const AT = 120;
  let input = c.input;
  let doc: SimPolicy4 = DEFAULT_POLICY4;
  let lots: Record<string, ParcelId[]> = {};
  if (variant === 'market') {
    const steps = input.market ?? [];
    const last = steps.length > 0 ? steps[steps.length - 1].logOdds : 0;
    input = {
      ...input,
      market: [...steps, { from: monthFirstDay(input.asOf, AT), logOdds: last - 0.5 }]
    };
  } else {
    const m = metroDoc(c.live, input, AT);
    doc = m.doc;
    lots = m.lots;
  }
  const ctx = ctxOf(c.live, input, c.months, yieldsOf(c.live, false, null));
  const tc = now();
  const plan = compileFully(doc, lots, ctx, 'plan');
  const cmp = comparisonOf(doc);
  const comp = compileFully(cmp.doc, {}, ctx, cmp.base);
  const compileMs = now() - tc;
  const rhna = c.live.loaded.projects.rhnaCompletedNet;
  const compiled = {
    plan,
    comp,
    compBase: cmp.base,
    planScore: scoreStaticsOf(input, plan.timeline, 'plan', c.months, rhna),
    compScore: scoreStaticsOf(input, comp.timeline, cmp.base, c.months, rhna),
    scoreMs: 0
  };
  const deps = streamDeps(input, c.live.records, { now });
  const s = createSession(input, c.money, compiled, c.worlds, c.months, deps);
  for (let month = 1; month < AT; month++)
    for (const e of [s.plan, s.comp]) for (const m of e.members) unit(s, e, m, month);
  const at: Record<string, Unit[]> = { plan: [], comparison: [] };
  const after: Record<string, number[]> = { plan: [], comparison: [] };
  for (const e of [s.plan, s.comp]) for (const m of e.members) at[e.name].push(unit(s, e, m, AT));
  for (const e of [s.plan, s.comp])
    for (const m of e.members) {
      const u = unit(s, e, m, AT + 1);
      after[e.name].push(u.step + u.score + u.map);
    }
  const show = (name: string, tl: PolicyTimeline) => {
    const us = at[name].map((u) => u.step + u.score + u.map);
    return {
      changesAt: tl.changes().filter((m) => m <= AT + 1),
      touchedAt120: (() => {
        const t = tl.touched(AT);
        return t === null ? 'null (every lot)' : t.length;
      })(),
      changeMonthUnit: stats(us),
      changeMonthStepOnly: stats(at[name].map((u) => u.step)),
      changeMonthAllWorldsMs: r1(us.reduce((a, b) => a + b, 0)),
      unitsOver50ms: us.filter((x) => x > 50).length,
      nextMonthUnit: stats(after[name])
    };
  };
  return {
    case: 'replan',
    variant,
    money: c.money,
    at: AT,
    worlds: `${c.worlds} + ${c.worlds}`,
    compileBothMs: r1(compileMs),
    plan: show('plan', plan.timeline),
    comparison: show('comparison', comp.timeline)
  };
}

/** Case 6: compiles of (a) one metro rule and (b) 500 painted lots, from month 1. */
function caseCompile(c: Common, noGross: boolean, runs: number) {
  const out: Record<string, unknown> = {};
  for (const name of ['metro', 'painted'] as const) {
    const one = () => {
      const seam: Seam = { recompute: [] };
      // a fresh input object: nothing memoised by input identity can hit
      const input: SimInput = { ...c.input, parcels: { ...c.input.parcels } };
      const ctx = ctxOf(c.live, input, c.months, yieldsOf(c.live, noGross, seam));
      const { doc, lots, resolveMs } =
        name === 'metro' ? metroDoc(c.live, input, 1) : paintedDoc(input);
      const r = compileFully(doc, lots, ctx, 'plan');
      return { ...r, resolveMs, seam };
    };
    one(); // warm-up
    const rs = Array.from({ length: runs }, one);
    const maxSlice = rs.map((r) => Math.max(...r.slices));
    out[name] = {
      lotResolutionMs: r1(rs[0].resolveMs),
      firstFrameMs: stats(
        rs.map((r) => r.firstMs + r.resolveMs),
        r1
      ),
      allFramesMs: stats(
        rs.map((r) => r.allMs + r.resolveMs),
        r1
      ),
      longestStep20Ms: stats(maxSlice, r1),
      slicesOver50ms: rs.map((r) => r.slices.filter((x) => x > 50).length),
      recomputeStepLongestMs: stats(
        rs.map((r) => Math.max(0, ...r.seam.recompute)),
        r1
      ),
      recomputeStepTotalMs: stats(
        rs.map((r) => r.seam.recompute.reduce((a, b) => a + b, 0)),
        r1
      ),
      recomputeSteps: rs[0].seam.recompute.length
    };
  }
  // the precomputeView seam is today's precomputeOf, whole: timed on fresh input objects
  const pre: number[] = [];
  for (let k = 0; k < runs + 1; k++) {
    const fresh: SimInput = { ...c.input };
    const t = now();
    precomputeOf(fresh);
    if (k > 0) pre.push(now() - t);
  }
  out.precomputeViewMs = stats(pre, r1);
  return {
    case: 'compile',
    yields: noGross ? 'chunk records (--no-gross)' : 'gross table',
    ...out
  };
}

/** Case 7: open to the first flushed cells and the first final calendar month (prototype). */
async function caseFirst(dir: string, extra: string | null, money: boolean, worlds: number) {
  const months = 480;
  const t0 = now();
  const live = await loadLive(dir, extra);
  const input = money ? live.funded : unfunded(live.funded);
  const tLoad = now() - t0;
  const ctx = ctxOf(live, input, months, yieldsOf(live, false, null));
  const planDoc = reconciled(DEFAULT_POLICY4, input);
  const cp = compileTimeline(planDoc, {}, ctx, 'plan');
  const cmp = comparisonOf(planDoc);
  const cc = compileTimeline(cmp.doc, {}, ctx, cmp.base);
  const ready = (x: typeof cp) => {
    try {
      x.result();
      return true;
    } catch {
      return false;
    }
  };
  while (!ready(cp)) cp.step(COMPILE_MS);
  while (!ready(cc)) cc.step(COMPILE_MS);
  const tFrame1 = now() - t0;
  while (!cp.step(COMPILE_MS));
  while (!cc.step(COMPILE_MS));
  const tCompiled = now() - t0;
  const rhna = live.loaded.projects.rhnaCompletedNet;
  const compiled = {
    plan: { timeline: cp.result(), firstMs: 0, allMs: 0, slices: [] },
    comp: { timeline: cc.result(), firstMs: 0, allMs: 0, slices: [] },
    compBase: cmp.base,
    planScore: scoreStaticsOf(input, cp.result(), 'plan', months, rhna),
    compScore: scoreStaticsOf(input, cc.result(), cmp.base, months, rhna),
    scoreMs: 0
  };
  const deps = streamDeps(input, live.records, { now });
  const s = createSession(input, money, compiled, worlds, months, deps);
  const tCreated = now() - t0;
  let flushes = 0;
  let longestFlush = 0;
  let firstCells = -1;
  let cells = 0;
  while (firstCells < 0) {
    const t = now();
    const u = s.stream.flush(s.plan.members[0].world, s.statics, FLUSH_MS);
    longestFlush = Math.max(longestFlush, now() - t);
    flushes++;
    if (u && u.cells.length > 0) {
      firstCells = now() - t0;
      cells = u.cells.length;
    }
    if (flushes > 10_000) throw new Error('no cells after 10,000 flushes');
  }
  let month = 0;
  let firstFilled = -1;
  while (firstFilled < 0) {
    month++;
    for (const e of [s.plan, s.comp]) for (const m of e.members) unit(s, e, m, month);
    const through = Math.min(
      s.plan.members[0].series.finalThrough(),
      s.comp.members[0].series.finalThrough()
    );
    if (through >= 0) {
      chunkOf(
        s.plan.members.map((m) => m.series),
        s.comp.members.map((m) => m.series),
        moneyFeedOf(s, through),
        0,
        through
      );
      firstFilled = now() - t0;
    }
  }
  return {
    case: 'first (prototype)',
    money,
    worlds: `${worlds} + ${worlds}`,
    loadMs: r1(tLoad),
    bothFrame1Ms: r1(tFrame1),
    bothCompiledMs: r1(tCompiled),
    createdMs: r1(tCreated),
    firstCellsMs: r1(firstCells),
    firstCellsFlushes: flushes,
    firstCellsCount: cells,
    longestFlushBeforeFirstCellsMs: r1(longestFlush),
    firstFilledMs: r1(firstFilled),
    firstFilledModelMonth: month
  };
}

/** Case 8: world 1 alone, flushed after every month at 20 ms; optionally warmed ahead (D12). */
function caseFlush(c: Common, warm: boolean) {
  const compiled = compileBoth(c.live, c.input, DEFAULT_POLICY4, c.months);
  const statics = staticsOf(c.input);
  const timeline = compiled.plan.timeline;
  const deps = streamDeps(c.input, c.live.records, { now }); // cold memo
  const stream = createMapStream(deps, c.months);
  const core = withFunding(c.money ? createFundingSystem() : null);
  const buf: WorldEvent[] = [];
  const sink: StepSink = { event: (e) => buf.push(e), ledger: () => {} };
  const world = core.createWorld(statics, timeline, 1, sink);
  const due = core.planDue(world, statics, timeline, 1, c.months);
  const queue: number[] = [];
  const pass = () => {
    for (const e of buf) {
      stream.onEvent(e, world, statics);
      if (e.kind === 'start' || e.kind === 'revise') queue.push(e.row);
    }
    buf.length = 0;
  };
  pass();

  const flushMs: number[] = [];
  const worst = { ms: 0, month: 0 };
  const warmMs: number[] = [];
  const warmWorst = { ms: 0, id: '', k: 0, month: 0 };
  const cold: { id: string; k: number; ms: number; month: number }[] = [];
  const warmed = new Set<string>();
  const warmAhead = () => {
    const day = monthLastDay(statics.asOf, world.month);
    for (const row of queue.splice(0)) {
      const sch = scheduleAt(world, statics, row, day);
      if (sch === null) continue;
      for (let k = 0; k < sch.revisions.length; k++) {
        const r = sch.revisions[k];
        const key = `${sch.projectId}|${k}|${r.day}|${r.units}|${r.stories}`;
        if (warmed.has(key)) continue;
        warmed.add(key);
        const t = now();
        try {
          massingFor(sch, k, deps.massing);
        } catch {
          // no loaded record: the stream skips this project too
        }
        const ms = now() - t;
        warmMs.push(ms);
        if (ms > warmWorst.ms)
          Object.assign(warmWorst, { ms, id: sch.projectId, k, month: world.month });
        if (ms > SLOW_MASSING_MS)
          cold.push({ id: sch.projectId, k, ms: r1(ms), month: world.month });
      }
    }
  };
  // the last non-null update's `complete` (map-stream.md, "Draining and `complete`")
  let complete = false;
  const flush = (budget: number) => {
    const t = now();
    const u = stream.flush(world, statics, budget);
    const ms = now() - t;
    flushMs.push(ms);
    if (ms > worst.ms) Object.assign(worst, { ms, month: world.month });
    if (u) complete = u.complete === true;
  };
  if (warm) warmAhead();
  flush(FLUSH_MS);
  while (world.month < c.months) {
    core.step(world, due, statics, timeline, 1, sink);
    pass();
    if (warm) warmAhead();
    flush(FLUSH_MS);
  }
  // D5: drain until an update says complete, never until null
  let drain = 0;
  while (!complete) {
    if (warm) warmAhead();
    flush(FLUSH_MS);
    drain++;
    if (drain > 100_000) throw new Error('drain did not complete');
  }
  const ts = now();
  stream.snapshot(world, statics);
  const snapWarm = now() - ts;
  const fresh = createMapStream(streamDeps(c.input, c.live.records, { now }), c.months);
  for (let row = 0; row < world.projects.n; row++)
    fresh.onEvent({ kind: 'start', row, day: statics.asOf }, world, statics);
  const tc = now();
  fresh.snapshot(world, statics);
  const snapCold = now() - tc;
  return {
    case: warm ? 'flush-warm' : 'flush',
    money: c.money,
    months: c.months,
    flushes: flushMs.length,
    flush: stats(flushMs, r1),
    longestFlush: { ms: r1(worst.ms), month: worst.month },
    flushesOver50ms: flushMs.filter((x) => x > 50).length,
    drainFlushes: drain,
    warm: warm
      ? {
          units: warmMs.length,
          unit: stats(warmMs, r1),
          longestUnit: { ...warmWorst, ms: r1(warmWorst.ms) },
          coldOver50ms: cold.sort((a, b) => b.ms - a.ms)
        }
      : null,
    longestUnresponsiveMs: r1(Math.max(worst.ms, warmWorst.ms)),
    snapshotWarmMs: r1(snapWarm),
    snapshotColdMs: r1(snapCold)
  };
}

/** Serialized bytes of a column set: as allocated, at its counts (`n`, `revN`, …), and `rowOf`. */
function partBytes(part: Record<string, unknown>) {
  const counts = Object.keys(part).filter(
    (k) => typeof part[k] === 'number' && (k === 'n' || k.endsWith('N'))
  );
  let alloc = 0;
  let atN = 0;
  let rowOf = 0;
  for (const [col, v] of Object.entries(part)) {
    if (typeof v === 'number') continue;
    const b = serialize(v).length;
    alloc += b;
    if (col === 'rowOf') {
      rowOf = b;
      continue;
    }
    let key = 'n';
    for (const k of counts)
      if (k !== 'n' && col.startsWith(k.slice(0, -1)) && k.length > key.length) key = k;
    const n = (part[key] as number | undefined) ?? 0;
    if (ArrayBuffer.isView(v)) atN += n * (v as unknown as Int32Array).BYTES_PER_ELEMENT;
    else if (Array.isArray(v)) atN += serialize(v.slice(0, n)).length;
    else atN += b;
  }
  return { alloc, atN, rowOf };
}

/**
 * Where a world's bytes go: `v8.serialize` sizes (a stand-in for a `structuredClone`'s) of world 1
 * of the plan, by part and by column, at months 0, 60 and `--months`, with its series data; then,
 * at `--months`, every world's parts as allocated and cut to their counts, the due lists, the
 * series data, world 1's ledger, and the map stream's memos (heap before and after a full drain).
 */
function caseSizes(c: Common) {
  const compiled = compileBoth(c.live, c.input, DEFAULT_POLICY4, c.months);
  const deps = streamDeps(c.input, c.live.records, { now });
  const s = createSession(c.input, c.money, compiled, c.worlds, c.months, deps);
  const kb = (x: unknown) => r1(serialize(x).length / 1024);
  const sizes = () => {
    const m = s.plan.members[0];
    const w = m.world as unknown as Record<string, unknown>;
    const parts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(w)) {
      if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
        const cols = Object.entries(v as Record<string, unknown>)
          .map(([ck, cv]) => [ck, kb(cv)] as const)
          .filter(([, x]) => x >= 1)
          .sort((a, b) => b[1] - a[1]);
        parts[k] = { kb: kb(v), n: (v as { n?: number }).n, columns: Object.fromEntries(cols) };
      } else parts[k] = kb(v);
    }
    return { month: m.world.month, worldKb: kb(m.world), seriesDataKb: kb(m.series.data()), parts };
  };
  const out = [sizes()];
  for (let month = 1; month <= c.months; month++) {
    for (const e of [s.plan, s.comp]) for (const m of e.members) unit(s, e, m, month);
    if (month === COPY_EVERY || month === c.months) out.push(sizes());
  }
  const all: Record<string, { alloc: number; atN: number }> = {};
  const add = (k: string, alloc: number, atN: number) => {
    all[k] ??= { alloc: 0, atN: 0 };
    all[k].alloc += alloc;
    all[k].atN += atN;
  };
  let n = 0;
  for (const e of [s.plan, s.comp])
    for (const m of e.members) {
      n++;
      const w = m.world as unknown as Record<string, Record<string, unknown>>;
      for (const part of ['lots', 'projects', 'line', 'pools']) {
        const b = partBytes(w[part]);
        add(part, b.alloc - b.rowOf, b.atN);
        if (part === 'lots') add('lots.rowOf', b.rowOf, 0);
      }
      const due = serialize(m.due).length;
      add('due list', due, due);
      const d = serialize(m.series.data()).length;
      add('series data()', d, d);
    }
  const ledger = serialize(s.ledger).length;
  add('ledger (world 1)', ledger, ledger);
  const totals = Object.fromEntries(
    Object.entries(all).map(([k, v]) => [
      k,
      { allocMb: MB(v.alloc), atNMb: MB(v.atN), perWorldKb: r1(v.alloc / n / 1024) }
    ])
  );
  const before = heapMb();
  for (let done = false; !done;) {
    const u = s.stream.flush(s.plan.members[0].world, s.statics, Infinity);
    done = u === null || u.complete === true;
  }
  const after = heapMb();
  return {
    case: 'sizes',
    money: c.money,
    worlds: n,
    sizes: out,
    allWorldsAtEnd: totals,
    mapDrainHeapDeltaMb: {
      heap: r1(after.heap - before.heap),
      arrayBuffers: r1(after.arrayBuffers - before.arrayBuffers),
      total: r1(after.total - before.total)
    }
  };
}

/**
 * Resuming after an edit at month m with a copy at month 0 only: every world and series restored
 * from the month 0 copy, each due list rebuilt (`planDue` through `--months`), world 1's ledger cut
 * back, then m months stepped quietly (series fed, ledger kept, no map stream, nothing posted).
 */
function caseResume(c: Common, ats: number[]) {
  const compiled = compileBoth(c.live, c.input, DEFAULT_POLICY4, c.months);
  const deps = streamDeps(c.input, c.live.records, { now });
  const s = createSession(c.input, c.money, compiled, c.worlds, c.months, deps);
  const copy = takeCopy(s);
  const results = [];
  for (const at of ats) {
    s.ledger.length = copy.ledgerLength;
    const t0 = now();
    const ens = [s.plan, s.comp].map((e, i) => ({
      e,
      members: e.members.map((m, k): Member => {
        const buf: WorldEvent[] = [];
        const sink: StepSink =
          e.name === 'plan' && m.seed === 1
            ? { event: (ev) => buf.push(ev), ledger: (ev) => s.ledger.push(ev) }
            : { event: (ev) => buf.push(ev) };
        return {
          seed: m.seed,
          world: structuredClone(copy.worlds[i][k]),
          due: m.due,
          series: createWorldSeries(e.score, copy.feeds[i][k]),
          buf,
          sink
        };
      })
    }));
    const restoreMs = now() - t0;
    const t1 = now();
    for (const { e, members } of ens)
      for (const m of members)
        m.due = s.core.planDue(m.world, s.statics, e.timeline, m.seed, c.months);
    const planMs = now() - t1;
    const perMonth: number[] = [];
    const t2 = now();
    for (let month = 1; month <= at; month++) {
      const tm = now();
      for (const { e, members } of ens)
        for (const m of members) {
          s.core.step(m.world, m.due, s.statics, e.timeline, m.seed, m.sink);
          for (const ev of m.buf) m.series.add(ev, m.world, s.statics);
          m.series.stepped(month);
          m.buf.length = 0;
        }
      perMonth.push(now() - tm);
    }
    const replayMs = now() - t2;
    results.push({
      m: at,
      restoreFromCopyMs: r1(restoreMs),
      planDueAllWorldsMs: r1(planMs),
      quietReplayMs: r1(replayMs),
      totalMs: r1(restoreMs + planMs + replayMs),
      perMonthAllWorlds: stats(perMonth)
    });
  }
  return { case: 'resume', money: c.money, worlds: `${c.worlds} + ${c.worlds}`, results };
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
  const dir = opt('--dir') ?? process.env.SFH_WORLD_LIVE ?? null;
  const which = opt('--case');
  if (!dir || !which) {
    console.error(
      'usage: node --expose-gc node_modules/.bin/tsx scripts/ensemble-measure.ts --dir <dataset> ' +
        '--case ensemble|replan|compile|first|flush|flush-warm|sizes|resume [--extra <dir>] [--no-gross] ' +
        '[--no-money] [--no-copies] [--copies 0,240] [--at 240,470] [--variant market|zoning] [--runs 3] [--worlds 48] [--months 480]'
    );
    return 2;
  }
  if (!gc) console.error('warning: run with node --expose-gc; heap numbers are without a gc');
  const extra = opt('--extra');
  const worlds = num('--worlds', 48);
  const months = num('--months', 480);
  const money = !has('--no-money');
  const env = () =>
    `Node ${process.version}, ${cpus()[0]?.model} (${cpus().length} cores), ` +
    `${Math.round(totalmem() / 2 ** 30)} GB, load ${loadavg()
      .map((x) => x.toFixed(2))
      .join(' ')}`;
  console.error(`before: ${env()}`);
  let result: unknown;
  if (which === 'first') {
    result = await caseFirst(dir, extra, money, worlds);
  } else {
    const live = await loadLive(dir, extra);
    const input = money ? live.funded : unfunded(live.funded);
    if (money && input.finance === undefined) throw new Error('dataset has no baseline funding');
    const copies = opt('--copies');
    const c: Common = {
      live,
      months,
      worlds,
      money,
      input,
      dropCopies: has('--no-copies'),
      copyMonths: copies === null ? null : copies.split(',').map(Number)
    };
    console.error(
      `${live.label}: ${input.parcels.count} parcels, gross table ${live.loaded.gross ? 'yes' : 'no'}, ` +
        `money ${money ? `${input.finance?.pools.length ?? 0} pools` : 'off'}, load ${r1(live.loadMs)} ms`
    );
    if (which === 'ensemble') result = caseEnsemble(c);
    else if (which === 'replan')
      result = caseReplan(c, opt('--variant') === 'zoning' ? 'zoning' : 'market');
    else if (which === 'compile') result = caseCompile(c, has('--no-gross'), num('--runs', 3));
    else if (which === 'flush') result = caseFlush(c, false);
    else if (which === 'flush-warm') result = caseFlush(c, true);
    else if (which === 'sizes') result = caseSizes(c);
    else if (which === 'resume')
      result = caseResume(c, (opt('--at') ?? '240,470').split(',').map(Number));
    else throw new Error(`unknown case ${which}`);
  }
  console.log(JSON.stringify({ dataset: dir.split('/').pop(), ...(result as object) }, null, 2));
  console.error(`after: ${env()}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
