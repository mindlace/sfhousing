// The timeline host (ensemble-runner Task 5): opening, filling two ensembles, the map stream, the
// shared lookups and failures, on fixture-0 with a fake clock that charges compute time.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { SLOT_FLAG, type TimelineUpdate } from '$lib/map/types';
import type { FetchLike } from '$lib/sim/chunks';
import { createLru } from '$lib/sim/lru';
import { scenarioUrls } from '$lib/sim/scenario/load';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { TimelineHostRequest, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER } from '$lib/timelapse/types';
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
import { anchoredRows, FakeController, markersOf } from './test/map-stream-run';
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
  const posts: { msg: Msg; task: number; transfer: ArrayBuffer[] }[] = [];
  const warns: string[] = [];
  const host = createTimelineHost({
    fetch: o.fetch ?? f.fetch,
    fetchBytes: f.fetchBytes,
    post: (msg, transfer) => posts.push({ msg, task, transfer }),
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

/** The two sides' worlds on seed 1 stepped in a plain loop, fed live, as one chunk. */
function plainLoop(
  doc: SimPolicy4,
  months: number,
  lots: Parameters<typeof compileTimeline>[1] = {}
): Plain {
  const { createWorld, step, planDue } = withFunding(createFundingSystem());
  const ctx = ctxOf(months);
  const rhna = ds.loaded.projects.rhnaCompletedNet;
  const c = comparisonOf(doc);
  const sides = [
    { doc, base: 'plan' as const },
    { doc: c.doc, base: c.base }
  ].map(({ doc: d, base }) => {
    const comp = compileTimeline(d, lots, ctx, base);
    expect(comp.step(Infinity)).toBe(true);
    const t = comp.result();
    const s = scoreStaticsOf(ds.loaded.fzp, t, base, months, rhna);
    return { t, s };
  });
  let world1: World | null = null;
  let ledger: LedgerEvent[] = [];
  const series = sides.map(({ t, s }, side): WorldSeries => {
    const ws = createWorldSeries(s);
    const buf: WorldEvent[] = [];
    const own: LedgerEvent[] = [];
    const ledgerSink = side === 0 ? (e: LedgerEvent) => own.push(e) : undefined;
    const w = createWorld(ds.statics, t, 1, { event: (e) => buf.push(e), ledger: ledgerSink });
    for (const e of buf) ws.add(e, w, ds.statics);
    const due = planDue(w, ds.statics, t, 1, months);
    const sink = { event: (e: WorldEvent) => ws.add(e, w, ds.statics), ledger: ledgerSink };
    while (w.month < months) {
      step(w, due, ds.statics, t, 1, sink);
      ws.stepped(w.month);
    }
    if (side === 0) {
      world1 = w;
      ledger = own;
    }
    return ws;
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

/** Project id → row of `w`, read at the end of its month. */
function rowsByProject(w: World): Map<string, number> {
  const day = monthLastDay(asOf, w.month);
  const out = new Map<string, number>();
  for (let row = 0; row < w.projects.n; row++) {
    const s = scheduleAt(w, ds.statics, row, day);
    if (s) out.set(s.projectId, row);
  }
  return out;
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
  let snapshot: { msg: Msg; task: number; transfer: ArrayBuffer[] }[];
  let plain: Plain;

  beforeAll(async () => {
    h = makeHost();
    h.open();
    h.prefetchAll();
    await h.runAll();
    snapshot = [...h.posts];
    plain = plainLoop(DEFAULT_POLICY4, MONTHS);
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

  it('the posted series equal a plain loop of the same world', () => {
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

  it('the default document posts no flagged slot', () => {
    const cells = snapshot.flatMap((p) => (p.msg.type === 'cells' ? p.msg.render.cells : []));
    expect(cells.length).toBeGreaterThan(0);
    const flagged = cells.filter(
      (c) => c.slotFlags?.length !== c.slotProjectIds.length || c.slotFlags.some((f) => f !== 0)
    );
    expect(flagged.map((c) => c.cellId)).toEqual([]);
  });

  /** Every other lot of the fixture painted to 20 stories from model month 1, filled 60 months. */
  let paintedRun: Promise<{
    p: Host;
    doc: SimPolicy4;
    painted: ParcelId[];
    lots: Record<string, ParcelId[]>;
  }> | null = null;
  const paintedHost = () =>
    (paintedRun ??= (async () => {
      const painted = ds.loaded.fzp.parcels.id.filter((_, i) => i % 2 === 0);
      const paint: CustomBrush = {
        id: 'paint-all',
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
        spans: [span(asOf, 1, null, { tag: 'brushes', brushes: [paint] })]
      });
      const lots = { [queryKey(customQuery(paint))]: painted };
      const p = makeHost();
      p.open({ policy: doc, lots, months: 60 });
      p.prefetchAll();
      await p.runAll();
      return { p, doc, painted, lots };
    })());

  it('with a painted policy from today, a slot on a painted lot carries the zoning bit', async () => {
    const { p, painted } = await paintedHost();
    expect(p.errors()).toEqual([]);
    const ctl = applyAll(p.of('cells').map((c) => c.render));
    const onPaint = new Set(painted);
    const NS = 7;
    let flaggedOnPaint = 0;
    const wrong: string[] = [];
    for (const c of ctl.cells.values()) {
      c.slotProjectIds.forEach((id, s) => {
        const zoning = (c.slotFlags![s] & SLOT_FLAG.zoning) !== 0;
        let first = Infinity;
        for (let j = 0; j < NS; j++) {
          const d = c.slotStages[NS * s + j];
          if (!Number.isNaN(d)) first = Math.min(first, d);
        }
        // simulated projects only: a pipeline phase entering after today was filed before it
        const want = id.startsWith('sim:') && onPaint.has(c.parcelIds[s]) && first > asOf;
        if (want) flaggedOnPaint++;
        if (zoning !== want) wrong.push(`${id} on ${c.parcelIds[s]}: ${zoning}`);
      });
    }
    expect(flaggedOnPaint).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('with a fund policy on an added pool, its funded slots carry the money bit', async () => {
    // a new pool with ample money from today and one grant programme on it (as fundingOnly())
    const base = fundingOnly();
    const pool = {
      ...base.pools[0],
      id: 'u-test-pool',
      inflows: [{ kind: 'yearly' as const, from: asOf, to: null, dollarsPerYear: 500_000_000 }]
    };
    const programme = {
      ...base.programmes[0],
      id: 'u-test-prog',
      pool: pool.id,
      instrument: { kind: 'grant' as const, share: 0.5 },
      from: asOf
    };
    expect(ds.loaded.fzp.finance!.pools.map((x) => x.id)).not.toContain(pool.id);
    const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
    doc.kinds.money.push({
      id: 'fund',
      label: 'fund',
      preset: null,
      on: true,
      where: { tag: 'fund', pool: pool.id },
      spans: [span(asOf, 1, null, { tag: 'fund', pool, programmes: [programme] })]
    });
    const months = 60;
    const f = makeHost();
    f.open({ policy: doc, months });
    f.prefetchAll();
    await f.runAll();
    expect(f.errors()).toEqual([]);
    // the host's plan world is the plain loop's (seed 1): its rows name what each slot is
    const w = plainLoop(doc, months).world1;
    const day = monthLastDay(asOf, w.month);
    const rowOf = new Map<string, number>();
    for (let row = 0; row < w.projects.n; row++) {
      const sc = scheduleAt(w, ds.statics, row, day);
      if (sc) rowOf.set(sc.projectId, row);
    }
    const ctl = applyAll(f.of('cells').map((c) => c.render));
    const money: string[] = [];
    for (const c of ctl.cells.values())
      c.slotProjectIds.forEach((id, s) => {
        if ((c.slotFlags![s] & SLOT_FLAG.money) !== 0) money.push(id);
      });
    expect(money.length).toBeGreaterThan(0);
    const wrong = money.filter((id) => {
      const row = rowOf.get(id);
      if (row === undefined || !id.startsWith('sim:')) return true;
      return (
        w.projects.funded[row] !== 1 ||
        !w.projects.programmes[row].split(',').includes(programme.id)
      );
    });
    expect(wrong).toEqual([]);
  });

  it("with a painted policy from today, a painted lot's marker carries the zoning bit its slot carries", async () => {
    const { p, doc, lots } = await paintedHost();
    const ctl = applyAll(p.of('cells').map((c) => c.render));
    const rowOf = rowsByProject(plainLoop(doc, 60, lots).world1);
    let zoned = 0;
    const wrong: string[] = [];
    for (const c of ctl.cells.values()) {
      c.slotProjectIds.forEach((id, s) => {
        const m = ctl.markers.get(rowOf.get(id)!);
        const slot = c.slotFlags![s] & SLOT_FLAG.zoning;
        if (slot !== 0) zoned++;
        if (m === undefined || (m.flags & SLOT_FLAG.zoning) !== slot) wrong.push(id);
      });
    }
    expect(zoned).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('the city feed holds one marker per drawn project, and each cells post transfers its buffers', () => {
    const posts = snapshot.filter((p) => p.msg.type === 'cells');
    const updates = posts.map((p) => (p.msg as Of<'cells'>).render);
    expect(updates[0].city).toBeDefined();
    let deltas = 0;
    for (const { msg, transfer } of posts) {
      const city = (msg as Of<'cells'>).render.city;
      // no buffer listed twice
      expect(new Set(transfer).size).toBe(transfer.length);
      if (!city) continue;
      deltas++;
      const bufs = [city.row, city.lngLat, city.days, city.homes, city.existing, city.flags].map(
        (a) => a.buffer
      );
      expect(bufs.filter((b) => !transfer.includes(b as ArrayBuffer))).toEqual([]);
    }
    expect(deltas).toBeGreaterThan(1);
    const ctl = applyAll(updates);
    const w = plain.world1;
    // every row with a T11 lot has its marker, loaded cell or not, and nothing else
    expect([...ctl.markers.keys()].sort((a, b) => a - b)).toEqual(
      anchoredRows(w, ds.statics, ds.loaded.fzp.parcels)
    );
    // fixture-0 loads every cell: each slot's row has a marker, and its days are the slot's
    const rowOf = rowsByProject(w);
    const CONSTRUCTION = STAGE_ORDER.indexOf('construction');
    const NS = STAGE_ORDER.length;
    let slots = 0;
    const wrong: string[] = [];
    for (const c of ctl.cells.values()) {
      c.slotProjectIds.forEach((id, s) => {
        slots++;
        const m = ctl.markers.get(rowOf.get(id)!);
        const done = c.slotEnd[2 * s + 1] === 1 ? c.slotEnd[2 * s] : NaN;
        const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));
        if (
          m === undefined ||
          !same(m.started, c.slotStages[NS * s + CONSTRUCTION]) ||
          !same(m.completed, done)
        )
          wrong.push(id);
      });
    }
    expect(slots).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('resyncMap answers a revision 0 whose city holds every marker', () => {
    const ctl = applyAll(snapshot.flatMap((p) => (p.msg.type === 'cells' ? [p.msg.render] : [])));
    const before = h.posts.length;
    h.handle({ type: 'resyncMap' });
    const got = h.posts.slice(before).filter((p) => p.msg.type === 'cells');
    expect(got.length).toBe(1);
    const render = (got[0].msg as Of<'cells'>).render;
    expect(render.revision).toBe(0);
    expect(render.city!.rows).toBe(plain.world1.projects.n);
    expect(markersOf(render.city!)).toEqual(ctl.markers);
    expect(got[0].transfer).toContain(render.city!.days.buffer);
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

  it('parcelSummary answers from the plan world with the frame lookups', async () => {
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

  it('heightLids answers with the lids of the zoning in view', async () => {
    const bbox = h.manifest.chunks[0].bbox as [number, number, number, number];
    const got = await h.ask({ type: 'heightLids', bbox }, 'heightLids');
    expect(got.result).toMatchObject({ ok: true, missing: 0 });
    expect(h.of('heights')).toHaveLength(1);
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
    boom.at = 1; // the plan's world steps first
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

  it('the posted series over 24 months equal stepping the same world in a plain loop', async () => {
    const h = makeHost();
    h.open({ months: 24 });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const plain = plainLoop(DEFAULT_POLICY4, 24);
    const chunks = h.of('filled').map((f) => f.series);
    expect(h.of('compiled')[0].statics).toEqual(plain.statics);
    expect(viewOf(chunks, plain.statics)).toEqual(viewOf([plain.chunk], plain.statics));
  });

  it('a failed needed chunk is reported and retryChunks completes the compile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`chunk ${cell.cellId} attempt 1 failed`),
      expect.objectContaining({ message: expect.stringContaining('HTTP 500') })
    );
    warn.mockRestore();
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
    let errored: () => void = () => {};
    const errorPosted = new Promise<void>((r) => (errored = r));
    const host = createTimelineHost({
      fetch: f.fetch,
      fetchBytes: f.fetchBytes,
      post: (msg) => {
        posts.push(msg);
        if (msg.type === 'error') errored();
      },
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
      months: 12
    });
    await errorPosted;
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
      months: 12
    };
    host.handle({ ...base, manifest: { nope: true } as unknown as Manifest });
    const noFzp = structuredClone(f.manifest);
    delete (noFzp as { scenarios?: unknown }).scenarios;
    host.handle({ ...base, manifest: noFzp });
    expect(posts.map((m) => (m.type === 'error' ? m.code : m.type))).toEqual([
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
    h.open({ policy: protectedFrom(1, 37), months: 24 });
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
    runner.open(1, protectedFrom(CHANGE, 41), {}, MONTHS);
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
      for (const e of [plan, comp]) n += e?.world?.month ?? 0;
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
    runner.open(1, protectedFrom(CHANGE, 43), {}, MONTHS);
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

describe('warm-ahead (D12)', () => {
  it('a slice runs no second warm unit whose estimate would overrun', async () => {
    // Every generator call costs 30 ms of the fake clock and records its task. The chunks of the
    // shared dataset are loaded, so the plan world's rows are warmed before the flushes mass them:
    // the generator runs in warm units only, and a second 30 ms unit never fits a 45 ms slice.
    const clock = fakeClock();
    let task = 0;
    const calls: number[] = [];
    const charged = <F extends (...a: never[]) => unknown>(f: F) =>
      ((...a: Parameters<F>) => {
        clock.tick(30);
        calls.push(task);
        return f(...a);
      }) as unknown as F;
    const memo = createLru<string, GeneratedBuilding | null>(10_000);
    const massing = {
      ...ds.massing,
      memo,
      gen: charged(ds.massing.gen),
      genForUnits: charged(ds.massing.genForUnits)
    };
    const posts: string[] = [];
    const runner: Runner = createRunner({
      dataset: { ...ds, memo, massing },
      post: (msg) => posts.push(msg.type),
      now: () => {
        clock.tick(0.1);
        return clock.now();
      },
      later: (fn, ms) =>
        clock.setTimeout(() => {
          task++;
          fn();
        }, ms),
      warn: () => {},
      logOnce: () => {}
    });
    runner.open(1, DEFAULT_POLICY4, {}, 60);
    await clock.runUntil(() => posts.includes('filled') && done());
    function done(): boolean {
      const w = runner.ensembles().plan?.world;
      return w != null && w.month === 60 && posts.includes('cells');
    }
    expect(posts).not.toContain('error');
    // (one revision per unit is warm.spec.ts's; fixture-0's plan world has no two-revision row)
    expect(calls.length).toBeGreaterThan(1);
    const perTask = new Map<number, number>();
    for (const t of calls) perTask.set(t, (perTask.get(t) ?? 0) + 1);
    expect(Math.max(...perTask.values())).toBe(1);
    runner.dispose();
  });
});
