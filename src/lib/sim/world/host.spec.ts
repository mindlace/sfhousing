// The timeline host (ensemble-runner Task 5): opening, filling two ensembles, the map stream, the
// shared lookups and failures, on fixture-0 with a fake clock that charges compute time.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import type { TimelineUpdate } from '$lib/map/types';
import type { FetchLike } from '$lib/sim/chunks';
import { createLru } from '$lib/sim/lru';
import { scenarioUrls } from '$lib/sim/scenario/load';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { TimelineHostRequest, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { createFundingSystem } from './funding';
import { createTimelineHost } from './host';
import { withFunding } from './index';
import { monthLastDay, monthOfDay } from './months';
import { comparisonOf } from './policy/compare';
import { compileTimeline, type CompileCtx } from './policy/compile';
import type { PolicyTimeline } from './policy/frame';
import { span, timingSet } from './policy/test/fixtures';
import { scheduleAt } from './read';
import {
  cardAt,
  chunkOf,
  createWorldSeries,
  scoreStaticsOf,
  viewOf,
  type ScoreStatics,
  type SeriesChunk,
  type WorldSeries
} from './score';
import { finalTable } from './score/statics';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './runner/dataset';
import { cardDepsOf } from './runner/lookups';
import { createRunner, type Runner } from './runner/runner';
import { datasetFetch, fakeClock } from './runner/test/harness';
import { FakeController } from './test/map-stream-run';
import type { World, WorldEvent } from './types';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';

// A seam for "a throw inside a unit": the next step of a world into month `at` throws once.
const boom = vi.hoisted(() => ({ at: -1 }));
vi.mock('./world', async (importOriginal) => {
  const m = await importOriginal<typeof import('./world')>();
  return {
    ...m,
    withFunding(f: Parameters<typeof m.withFunding>[0]) {
      const core = m.withFunding(f);
      return {
        ...core,
        step(w: World, ...rest: unknown[]) {
          if (boom.at >= 0 && w.month + 1 === boom.at) {
            boom.at = -1;
            throw new Error('boom');
          }
          return (core.step as (...a: unknown[]) => void)(w, ...rest);
        }
      };
    }
  };
});

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const MONTHS = 130;
const WORLDS = 4;
/** Compute time charged per clock read, so slices end and flushes come due. */
const TICK_MS = 0.1;

type Msg = TimelineHostResponse;
type Of<T extends Msg['type']> = Extract<Msg, { type: T }>;

let ds: Dataset;
let asOf: Day;
const ctxOf = (months: number): CompileCtx => ds.ctx(months);

beforeAll(async () => {
  const { manifest, fetch, fetchBytes } = datasetFetch(FIXTURE);
  const deps: DatasetDeps = {
    fetch,
    fetchBytes,
    later: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => 0,
    warn: () => {},
    retryDelaysMs: [],
    maxConcurrent: 4,
    stopped: () => false,
    onChunk: () => {},
    onChunksReport: () => {}
  };
  const r = await loadDataset(
    manifest,
    scenarioUrls(manifest)!,
    createChunkSet(manifest, deps),
    deps,
    createLru<string, GeneratedBuilding | null>(1000),
    { gen: generate, genForUnits: generateForUnits, logOnce: () => {} }
  );
  if ('code' in r) throw new Error(`load failed: ${r.code} ${r.message}`);
  ds = r;
  ds.chunks.want(manifest.chunks.map((c) => c.cellId));
  for (let k = 0; k < 200 && ds.chunks.byCell.size < manifest.chunks.length; k++)
    await new Promise((res) => setImmediate(res));
  expect(ds.chunks.byCell.size).toBe(manifest.chunks.length);
  asOf = ds.loaded.fzp.asOf;
});

/** The whole fixture's bbox. */
function allBbox(m: Manifest): [number, number, number, number] {
  const b = m.chunks.map((c) => c.bbox);
  return [
    Math.min(...b.map((x) => x[0])),
    Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])),
    Math.max(...b.map((x) => x[3]))
  ];
}

interface HostOpts {
  manifest?: Manifest;
  fetch?: FetchLike;
  retryDelaysMs?: number[];
  /** Compute time charged per clock read (default `TICK_MS`). */
  tickMs?: number;
}

function makeHost(o: HostOpts = {}) {
  const f = datasetFetch(FIXTURE);
  const manifest = o.manifest ?? f.manifest;
  const clock = fakeClock();
  let task = 0;
  let seq = 0;
  const posts: { msg: Msg; task: number }[] = [];
  const warns: string[] = [];
  const host = createTimelineHost({
    fetch: o.fetch ?? f.fetch,
    fetchBytes: f.fetchBytes,
    post: (msg) => posts.push({ msg, task }),
    setTimeout: (fn, ms) =>
      clock.setTimeout(() => {
        task = ++seq;
        fn();
      }, ms),
    clearTimeout: (h) => clock.clearTimeout(h),
    now: () => {
      clock.tick(o.tickMs ?? TICK_MS);
      return clock.now();
    },
    retryDelaysMs: o.retryDelaysMs ?? [],
    warn: (m) => warns.push(m)
  });
  const handle = (req: TimelineHostRequest) => {
    task = ++seq;
    host.handle(req);
  };
  const of = <T extends Msg['type']>(type: T, from = 0): Of<T>[] =>
    posts.slice(from).flatMap((p) => (p.msg.type === type ? [p.msg as Of<T>] : []));
  const open = (over: Partial<Extract<TimelineHostRequest, { type: 'openTimeline' }>> = {}) =>
    handle({
      type: 'openTimeline',
      rev: 1,
      manifest,
      policy: DEFAULT_POLICY4,
      lots: {},
      worlds: WORLDS,
      months: MONTHS,
      ...over
    });
  const prefetchAll = () => handle({ type: 'prefetch', bbox: allBbox(manifest) });
  const filledAll = () => {
    const c = of('compiled').at(-1);
    const fl = of('filled').at(-1);
    return !!c && !!fl && fl.through === c.statics.lastIndex;
  };
  const drained = () => of('cells').at(-1)?.render.complete === true;
  /**
   * Fires timers until `pred()` holds. With no timer pending it waits real turns: the dataset's
   * decode (an inflate) runs on the real event loop and can take many turns on a loaded machine.
   */
  async function run(pred: () => boolean, maxTimers = 10_000, maxIdleTurns = 5_000) {
    let timers = 0;
    let turns = 0;
    while (!pred() && timers < maxTimers && turns < maxIdleTurns) {
      if (await clock.runNext()) timers++;
      else {
        turns++;
        await new Promise((r) => setImmediate(r));
      }
    }
    if (!pred()) throw new Error(`run: the condition never held (${timers} timers)`);
  }
  const runAll = () => run(() => filledAll() && drained());
  /** Settles and fires timers until none is left (at most `max`); true when it idled. */
  const idle = async (max = 200) => {
    for (let k = 0; k < max; k++) if (!(await clock.runNext())) return true;
    return false;
  };
  let reqId = 0;
  /** Sends a request with a fresh reqId and runs until its answer is posted. */
  async function ask<T extends Msg['type']>(req: Record<string, unknown>, type: T): Promise<Of<T>> {
    const id = ++reqId;
    handle({ ...req, reqId: id } as TimelineHostRequest);
    const got = () =>
      of(type).find((m) => (m as unknown as { reqId: number }).reqId === id) as Of<T> | undefined;
    await run(() => got() !== undefined);
    return got()!;
  }
  const errors = () => of('error');
  return {
    host,
    clock,
    run,
    posts,
    warns,
    handle,
    of,
    open,
    prefetchAll,
    runAll,
    idle,
    ask,
    errors,
    manifest
  };
}
type Host = ReturnType<typeof makeHost>;

// --- the plain loop ---

interface Plain {
  plan: PolicyTimeline;
  statics: ScoreStatics;
  chunk: SeriesChunk;
  world1: World;
}

/** The two ensembles stepped in a plain loop, fed live, as one chunk over every month. */
function plainLoop(doc: SimPolicy4, worlds: number, months: number): Plain {
  const { createWorld, step, planDue } = withFunding(createFundingSystem());
  const ctx = ctxOf(months);
  const rhna = ds.loaded.projects.rhnaCompletedNet;
  const c = comparisonOf(doc);
  const sides = [
    { doc, base: 'plan' as const },
    { doc: c.doc, base: c.base }
  ].map(({ doc: d, base }) => {
    const comp = compileTimeline(d, {}, ctx, base);
    expect(comp.step(Infinity)).toBe(true);
    const t = comp.result();
    const s = scoreStaticsOf(ds.loaded.fzp, t, base, months, rhna);
    return { t, s };
  });
  let world1: World | null = null;
  let ledger: LedgerEvent[] = [];
  const series = sides.map(({ t, s }, side) => {
    const out: WorldSeries[] = [];
    for (let k = 1; k <= worlds; k++) {
      const ws = createWorldSeries(s);
      const buf: WorldEvent[] = [];
      const own: LedgerEvent[] = [];
      const ledgerSink = side === 0 && k === 1 ? (e: LedgerEvent) => own.push(e) : undefined;
      const w = createWorld(ds.statics, t, k, { event: (e) => buf.push(e), ledger: ledgerSink });
      for (const e of buf) ws.add(e, w, ds.statics);
      const due = planDue(w, ds.statics, t, k, months);
      const sink = { event: (e: WorldEvent) => ws.add(e, w, ds.statics), ledger: ledgerSink };
      while (w.month < months) {
        step(w, due, ds.statics, t, k, sink);
        ws.stepped(w.month);
      }
      if (side === 0 && k === 1) {
        world1 = w;
        ledger = own;
      }
      out.push(ws);
    }
    return out;
  });
  const { t, s } = sides[0];
  const fin = t.frameAt(1).finance;
  const last = finalTable(s)[s.lastIndex];
  const money =
    fin === null || fin.pools.length === 0
      ? null
      : {
          ledger,
          finance: t.frameAt(Math.max(1, last)).finance!,
          world: world1!,
          statics: ds.statics
        };
  return {
    plan: t,
    statics: s,
    chunk: chunkOf(series[0], series[1], money, 0, s.lastIndex),
    world1: world1!
  };
}

/** A row of `w` with a schedule on a loaded lot at `day`: its parcel and project. */
function projectLot(w: World, day: Day): { parcelId: ParcelId; projectId: string } {
  for (let row = 0; row < w.projects.n; row++) {
    const s = scheduleAt(w, ds.statics, row, day);
    const id = s?.parcelIds.find((p) => ds.chunks.records.has(p));
    if (s && id) return { parcelId: id, projectId: s.projectId };
  }
  throw new Error('no project on a loaded lot');
}

/** `cardAt` on a plain world, as the host should answer it. */
function expectedCard(
  w: World,
  t: PolicyTimeline,
  parcelId: ParcelId,
  day: Day,
  frameMonth: number,
  projectId?: string
) {
  const frame = t.frameAt(frameMonth);
  const { summary, lookups } = cardAt(
    w,
    ds.statics,
    frame,
    cardDepsOf(
      ds,
      () => frame.view.parcels,
      () => {}
    ),
    parcelId,
    day,
    projectId
  );
  summary.lookups = lookups ?? undefined;
  return summary;
}

/** Cells of every `cells` post, applied in order on a fake map controller. */
function applyAll(updates: TimelineUpdate[]): FakeController {
  const ctl = new FakeController();
  for (const u of updates) ctl.apply(u);
  return ctl;
}

// --- one full fill shared by the tests below ---

describe('a full fill of the default document', () => {
  let h: Host;
  let snapshot: { msg: Msg; task: number }[];
  let plain: Plain;

  beforeAll(async () => {
    h = makeHost();
    h.open();
    h.prefetchAll();
    await h.runAll();
    snapshot = [...h.posts];
    plain = plainLoop(DEFAULT_POLICY4, WORLDS, MONTHS);
  });

  it('open posts ready, compiled, lookups, then contiguous filled from 0 to lastIndex', () => {
    expect(h.errors()).toEqual([]);
    const types = snapshot.map((p) => p.msg.type);
    expect(types[0]).toBe('ready');
    const firstFilled = types.indexOf('filled');
    expect(types.indexOf('compiled')).toBeGreaterThan(0);
    expect(types.indexOf('lookups')).toBeGreaterThan(0);
    expect(firstFilled).toBeGreaterThan(types.indexOf('compiled'));
    expect(firstFilled).toBeGreaterThan(types.indexOf('lookups'));
    const filled = h.of('filled');
    expect(filled.length).toBeGreaterThan(2);
    const froms = filled.map((f) => f.series.from);
    expect(froms).toEqual([0, ...filled.slice(0, -1).map((f) => f.through + 1)]);
    const statics = h.of('compiled')[0].statics;
    expect(filled.at(-1)!.through).toBe(statics.lastIndex);
    expect(filled.every((f) => f.rev === 1)).toBe(true);
  });

  it('filled carries money and tiers with baseline funding', () => {
    expect(ds.loaded.fzp.finance).toBeDefined();
    const last = h.of('filled').at(-1)!;
    expect(last.series.money).not.toBeNull();
    expect(last.series.tiers).not.toBeNull();
  });

  it('the posted series equal a plain loop of the same worlds', () => {
    const chunks = h.of('filled').map((f) => f.series);
    expect(h.of('compiled')[0].statics).toEqual(plain.statics);
    expect(viewOf(chunks, plain.statics)).toEqual(viewOf([plain.chunk], plain.statics));
  });

  it('cells revisions are contiguous and a fake controller applies them', () => {
    const cells = snapshot.flatMap((p) => (p.msg.type === 'cells' ? [p.msg.render] : []));
    expect(cells[0].revision).toBe(0);
    const ctl = applyAll(cells);
    expect(ctl.cells.size).toBeGreaterThan(0);
    expect(cells.at(-1)!.complete).toBe(true);
  });

  it('at most one filled per slice and no flush inside a unit slice', () => {
    const byTask = new Map<number, string[]>();
    for (const p of snapshot) {
      const l = byTask.get(p.task) ?? [];
      l.push(p.msg.type);
      byTask.set(p.task, l);
    }
    for (const types of byTask.values()) {
      expect(types.filter((t) => t === 'filled').length).toBeLessThanOrEqual(1);
      if (types.includes('cells')) {
        expect(types.filter((t) => ['filled', 'compiling', 'compiled'].includes(t))).toEqual([]);
      }
    }
  });

  it('resyncMap answers a revision 0 holding every cell', () => {
    const cells = snapshot.flatMap((p) => (p.msg.type === 'cells' ? [p.msg.render] : []));
    const ctl = applyAll(cells);
    const before = h.posts.length;
    h.handle({ type: 'resyncMap' });
    const got = h.of('cells', before);
    expect(got.length).toBe(1);
    const render = got[0].render;
    expect(render.revision).toBe(0);
    expect(render.cells.map((c) => c.cellId).sort()).toEqual([...ctl.cells.keys()].sort());
    expect(new Map(render.demolish.map((d) => [d.parcelId, d.day]))).toEqual(ctl.demolished);
  });

  it('parcelSummary answers from world 1 with the frame lookups', async () => {
    const day = monthLastDay(asOf, 60);
    const { parcelId, projectId } = projectLot(plain.world1, day);
    const got = await h.ask({ type: 'parcelSummary', parcelId, day, projectId }, 'parcelSummary');
    expect(got.summary).not.toBeNull();
    expect(got.summary!.project).toBeDefined();
    expect(got.summary!.lookups).toBeDefined();
    expect(got.summary).toEqual(
      expectedCard(plain.world1, plain.plan, parcelId, day, monthOfDay(asOf, day), projectId)
    );
  });

  it('parcelSummary clamps the day and the frame month', async () => {
    const lastDay = monthLastDay(asOf, MONTHS);
    const { parcelId } = projectLot(plain.world1, lastDay);
    const early = asOf - 40;
    const a = await h.ask({ type: 'parcelSummary', parcelId, day: early }, 'parcelSummary');
    expect(a.summary).toEqual(expectedCard(plain.world1, plain.plan, parcelId, early, 1));
    const b = await h.ask(
      { type: 'parcelSummary', parcelId, day: lastDay + 4000 },
      'parcelSummary'
    );
    expect(b.summary).toEqual(expectedCard(plain.world1, plain.plan, parcelId, lastDay, MONTHS));
    const missing = await h.ask(
      { type: 'parcelSummary', parcelId: 'NOT-A-LOT', day: lastDay },
      'parcelSummary'
    );
    expect(missing.summary).toBeNull();
  });

  it('shared lookups answer in timeline mode', async () => {
    const rec = [...ds.chunks.records.values()][0];
    const point = rec.labelPoint as [number, number];
    const stroke = { path: [point], radiusM: 30 };
    const brush = await h.ask(
      { type: 'resolveBrush', query: { kind: 'freehand', strokes: [stroke] } },
      'brushLots'
    );
    expect(brush.result.ok).toBe(true);
    const catalog = await h.ask({ type: 'brushCatalog' }, 'brushCatalog');
    expect(catalog.catalog).not.toBeNull();
    const outlines = await h.ask({ type: 'lotOutlines', lots: [rec.id] }, 'lotOutlines');
    expect(outlines.result).toMatchObject({ ok: true, missing: 0 });
    const at = await h.ask({ type: 'lotAt', point: [0, 0] }, 'lotAt');
    expect(at.result).toEqual({ ok: true, parcelId: null, owner: null });
    const preview = await h.ask(
      { type: 'previewBuildings', lots: [rec.id], stories: 6 },
      'previewBuildings'
    );
    expect(preview.result.ok).toBe(true);
  });

  it('heightLids answers not available', async () => {
    const got = await h.ask({ type: 'heightLids', bbox: allBbox(h.manifest) }, 'heightLids');
    expect(got.result).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it('viewMonth clamps out-of-range months', async () => {
    const before = h.of('lookups').length;
    for (const m of [0, -3, 10_000, Number.NaN]) h.handle({ type: 'viewMonth', month: m });
    expect(await h.idle()).toBe(true);
    expect(h.errors()).toEqual([]);
    // one permitting in the default document: no new lookups
    expect(h.of('lookups').length).toBe(before);
    const at = await h.ask({ type: 'lotAt', point: [0, 0] }, 'lotAt');
    expect(at.result.ok).toBe(true);
  });
});

describe('the host', () => {
  it('viewMonth into a frame with different permitting posts lookups; same permitting posts none', async () => {
    const timing: Policy = {
      id: 't',
      label: 't',
      preset: null,
      on: true,
      where: { tag: 'routes' },
      spans: [
        span(asOf, 13, null, {
          tag: 'timing',
          set: timingSet({
            edits: [{ pathway: 'discretionary', stage: 'permitFiled', scale: 0.5, reach: 'all' }]
          })
        })
      ]
    };
    const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
    doc.kinds.permitting.push(timing);
    const h = makeHost();
    h.open({ policy: doc, months: 40 });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const count = () => h.of('lookups').length;
    expect(count()).toBe(1);
    expect(h.of('lookups')[0].month).toBe(1);
    h.handle({ type: 'viewMonth', month: 5 });
    expect(count()).toBe(1);
    h.handle({ type: 'viewMonth', month: 20 });
    expect(count()).toBe(2);
    expect(h.of('lookups')[1].month).toBe(20);
    h.handle({ type: 'viewMonth', month: 25 });
    expect(count()).toBe(2);
    h.handle({ type: 'viewMonth', month: 3 });
    expect(count()).toBe(3);
    expect(h.of('lookups')[2].lookups).not.toBe(h.of('lookups')[0].lookups);
    expect(h.of('lookups')[2].lookups).toEqual(h.of('lookups')[0].lookups);
  });

  it('a throw inside a unit posts error timeline and stops filling', async () => {
    const h = makeHost();
    h.open();
    h.prefetchAll();
    boom.at = 40;
    await h.run(() => h.errors().length > 0);
    expect(boom.at).toBe(-1);
    expect(h.errors()).toEqual([
      { type: 'error', rev: 1, code: 'timeline', message: 'Error: boom' }
    ]);
    const errAt = h.posts.findIndex((p) => p.msg.type === 'error');
    expect(await h.idle()).toBe(true);
    expect(h.posts.slice(errAt + 1).filter((p) => p.msg.type === 'filled')).toEqual([]);
    const statics = h.of('compiled')[0]?.statics;
    expect(h.of('filled').at(-1)?.through ?? -1).toBeLessThan(statics?.lastIndex ?? Infinity);
    const rec = [...ds.chunks.records.keys()][0];
    const got = await h.ask(
      { type: 'parcelSummary', parcelId: rec, day: asOf + 10 },
      'parcelSummary'
    );
    expect(got.summary).not.toBeNull();
  });

  it('parcelSummary before any step reads month 0 and frame month 1', async () => {
    const h = makeHost();
    h.open();
    h.prefetchAll();
    boom.at = 1; // world 1 of the plan is the first world to step
    await h.run(() => h.errors().length > 0);
    expect(await h.idle()).toBe(true);
    const { createWorld } = withFunding(createFundingSystem());
    const ctx = ctxOf(MONTHS);
    const c = compileTimeline(DEFAULT_POLICY4, {}, ctx, 'plan');
    expect(c.step(Infinity)).toBe(true);
    const t = c.result();
    const w = createWorld(ds.statics, t, 1, { event() {} });
    const { parcelId } = projectLot(w, asOf);
    const got = await h.ask(
      { type: 'parcelSummary', parcelId, day: monthLastDay(asOf, 50) },
      'parcelSummary'
    );
    expect(got.summary).toEqual(expectedCard(w, t, parcelId, asOf, 1));
  });

  it('the posted series equal stepping the same worlds in a plain loop', async () => {
    const h = makeHost();
    h.open({ worlds: 96, months: 24 });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const plain = plainLoop(DEFAULT_POLICY4, 96, 24);
    const chunks = h.of('filled').map((f) => f.series);
    expect(h.of('compiled')[0].statics).toEqual(plain.statics);
    expect(viewOf(chunks, plain.statics)).toEqual(viewOf([plain.chunk], plain.statics));
  });

  it('a failed needed chunk is reported and retryChunks completes the compile', async () => {
    const f = datasetFetch(FIXTURE);
    const manifest = structuredClone(f.manifest);
    delete (manifest.scenarios!.fzp as { gross?: string }).gross;
    const cell = manifest.chunks[0];
    let failures = 2;
    const fetch: FetchLike = (url) => {
      if (url === cell.url && failures > 0) {
        failures--;
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return f.fetch(url);
    };
    const ids = ((await (await f.fetch(cell.url)).json()) as { id: ParcelId[] }).id.slice(0, 8);
    const rec = ids[0];
    const paint: CustomBrush = {
      id: 'paint',
      kind: 'paint',
      strokes: [{ path: [[-122.419, 37.76]], radiusM: 30 }],
      stories: 20
    };
    const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
    doc.kinds.zoning.push({
      id: 'p',
      label: 'p',
      preset: null,
      on: true,
      where: { tag: 'painted' },
      spans: [span(asOf, 13, null, { tag: 'brushes', brushes: [paint] })]
    });
    const lots = { [queryKey(customQuery(paint))]: ids };
    const h = makeHost({ manifest, fetch, retryDelaysMs: [1] });
    h.open({ policy: doc, lots, months: 40 });
    const failed = () => h.of('compiling').some((c) => c.failedCells.includes(cell.cellId));
    await h.run(failed);
    // idles rather than spinning, and nothing is compiled while the chunk is missing
    expect(await h.idle()).toBe(true);
    expect(h.of('compiled')).toEqual([]);
    expect(h.of('chunks').at(-1)!.failed).toEqual([cell.cellId]);
    expect(rec).toBeDefined();
    h.handle({ type: 'retryChunks' });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.of('compiling').at(-1)!.failedCells).toEqual([]);
    expect(h.of('compiled')).toHaveLength(1);
  });

  it('a second openTimeline silences the first session', async () => {
    const h = makeHost();
    h.open({ rev: 1 });
    h.handle({ type: 'brushCatalog', reqId: 900 });
    h.open({ rev: 2 });
    const answered = h.of('brushCatalog').filter((m) => m.reqId === 900);
    expect(answered).toEqual([{ type: 'brushCatalog', reqId: 900, catalog: null }]);
    h.prefetchAll();
    await h.run(() => h.of('filled').length > 0);
    h.open({ rev: 3 });
    const readyAt = h.posts.findIndex((p) => p.msg.type === 'ready' && p.msg.rev === 3);
    h.prefetchAll();
    await h.runAll();
    const after = h.posts.slice(readyAt + 1).map((p) => p.msg);
    const revs = after.flatMap((m) => ('rev' in m ? [m.rev] : []));
    expect(revs.length).toBeGreaterThan(0);
    expect(revs.every((r) => r === 3)).toBe(true);
    const cells = after.flatMap((m) => (m.type === 'cells' ? [m.render] : []));
    expect(cells[0].revision).toBe(0);
    expect(() => applyAll(cells)).not.toThrow();
    expect(h.of('filled').filter((m) => m.rev === 2).length).toBeGreaterThan(0);
  });

  it('a rejected load answers internal', async () => {
    const f = datasetFetch(FIXTURE);
    const host = createTimelineHost({
      fetch: f.fetch,
      fetchBytes: f.fetchBytes,
      post: (msg) => posts.push(msg),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => 0,
      load: () => Promise.reject(new Error('disk on fire'))
    });
    const posts: Msg[] = [];
    host.handle({
      type: 'openTimeline',
      rev: 7,
      manifest: f.manifest,
      policy: DEFAULT_POLICY4,
      lots: {},
      worlds: 1,
      months: 12
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(posts.map((m) => m.type)).toEqual(['ready', 'error']);
    expect(posts[1]).toMatchObject({ rev: 7, code: 'internal' });
  });

  it('openTimeline checks the request, the manifest and the scenario', () => {
    const f = datasetFetch(FIXTURE);
    const posts: Msg[] = [];
    const host = createTimelineHost({
      fetch: f.fetch,
      fetchBytes: f.fetchBytes,
      post: (msg) => posts.push(msg),
      setTimeout: () => 0,
      clearTimeout: () => {},
      now: () => 0
    });
    const base = {
      type: 'openTimeline' as const,
      rev: 2,
      manifest: f.manifest,
      policy: DEFAULT_POLICY4,
      lots: {},
      worlds: 1,
      months: 12
    };
    host.handle({ ...base, worlds: 0 });
    host.handle({ ...base, manifest: { nope: true } as unknown as Manifest });
    const noFzp = structuredClone(f.manifest);
    delete (noFzp as { scenarios?: unknown }).scenarios;
    host.handle({ ...base, manifest: noFzp });
    expect(posts.map((m) => (m.type === 'error' ? m.code : m.type))).toEqual([
      'bad-request',
      'manifest-invalid',
      'scenario-missing'
    ]);
  });
});

/** The default document plus lots newer than `years` protected from model month `from`. */
function protectedFrom(from: number, years: number): SimPolicy4 {
  const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
  doc.kinds.zoning.push({
    id: `newer-${years}`,
    label: 'newer',
    preset: null,
    on: true,
    where: { tag: 'category', category: 'newerThan' },
    spans: [span(asOf, from, null, { tag: 'protect', years })]
  });
  return doc;
}

describe('compiles while filling', () => {
  it('a compile whose view-job units each spend the budget finishes with no chunk arriving', async () => {
    // 25 ms per clock read: every unit of a view job (resolve, apply, precompute) spends the 20 ms
    // compile budget, so a step returns false having moved neither the frames nor the recompute
    // count. The compile is still progressing and must not wait for a chunk.
    const h = makeHost({ tickMs: 25 });
    h.open({ policy: protectedFrom(1, 37), worlds: 2, months: 24 });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.of('compiled')).toHaveLength(1);
    expect(h.of('chunks')).toEqual([]);
  });

  it('a zoning change at a later month posts compiled and a first filled before the worlds reach it', async () => {
    const clock = fakeClock();
    const at: { type: string; plan: number; comp: number }[] = [];
    // 1 ms per clock read, the compile's clock included: a 20 ms step assembles about 20 frames
    const now = () => {
      clock.tick(1);
      return clock.now();
    };
    const runner: Runner = createRunner({
      dataset: { ...ds, ctx: (m) => ({ ...ds.ctx(m), now }) },
      post(msg) {
        const { plan, comp } = runner.ensembles();
        at.push({ type: msg.type, plan: plan?.month ?? -1, comp: comp?.month ?? -1 });
      },
      now,
      later: (fn, ms) => clock.setTimeout(fn, ms),
      warn: () => {},
      logOnce: () => {}
    });
    const CHANGE = 100;
    runner.open(1, protectedFrom(CHANGE, 41), {}, WORLDS, MONTHS);
    await clock.runUntil(() => at.some((a) => a.type === 'filled'));
    expect(at.filter((a) => a.type === 'error')).toEqual([]);
    const compiled = at.find((a) => a.type === 'compiled')!;
    const filled = at.find((a) => a.type === 'filled')!;
    for (const a of [compiled, filled]) {
      expect(a.plan).toBeLessThan(CHANGE - 1);
      expect(a.comp).toBeLessThan(CHANGE - 1);
    }
    runner.dispose();
  });

  it('a compile step costing more than a slice neither ends slices nor starves', async () => {
    // Runner reads cost 1 ms; the first compile read after any runner read costs 46 ms, later
    // ones 1 ms: every compile step costs over SLICE_PLAN_MS (45) and assembles about 20 frames.
    const clock = fakeClock();
    let inCompile = false;
    const now = () => {
      inCompile = false;
      clock.tick(1);
      return clock.now();
    };
    const compileNow = () => {
      clock.tick(inCompile ? 1 : 46);
      inCompile = true;
      return clock.now();
    };
    const at: { type: string; plan: number; comp: number }[] = [];
    /** World-months stepped by each task, and whether `compiled` had been posted before it. */
    const tasks: { steps: number; compiled: boolean }[] = [];
    const stepped = () => {
      const { plan, comp } = runner.ensembles();
      let n = 0;
      for (const e of [plan, comp]) for (const w of e?.worlds ?? []) n += w.month;
      return n;
    };
    const runner: Runner = createRunner({
      dataset: { ...ds, ctx: (m) => ({ ...ds.ctx(m), now: compileNow }) },
      post(msg) {
        const { plan, comp } = runner.ensembles();
        at.push({ type: msg.type, plan: plan?.month ?? -1, comp: comp?.month ?? -1 });
      },
      now,
      later: (fn, ms) =>
        clock.setTimeout(() => {
          const compiled = at.some((a) => a.type === 'compiled');
          const before = stepped();
          fn();
          tasks.push({ steps: stepped() - before, compiled });
        }, ms),
      warn: () => {},
      logOnce: () => {}
    });
    const CHANGE = 100;
    runner.open(1, protectedFrom(CHANGE, 43), {}, WORLDS, MONTHS);
    await clock.runUntil(() => at.some((a) => a.type === 'filled'));
    expect(at.filter((a) => a.type === 'error')).toEqual([]);
    const compiled = at.find((a) => a.type === 'compiled')!;
    expect(compiled.plan).toBeLessThan(CHANGE - 1);
    expect(compiled.comp).toBeLessThan(CHANGE - 1);
    // while the compiles ran ahead, slices still carried several world steps
    const early = tasks.filter((t) => !t.compiled);
    expect(Math.max(...early.map((t) => t.steps))).toBeGreaterThanOrEqual(4);
    runner.dispose();
  });
});
