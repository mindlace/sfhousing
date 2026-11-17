// The timeline host's edits (ensemble-runner Task 6, spec rules 12 to 17, 20; plan D2, D4): keep
// or restore each ensemble after a `setPolicy`, one `refill`, the new `rev`, and what the runner
// still holds afterwards. Fixture-0, one world a side, a fake clock that charges compute time.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import type { TimelineUpdate } from '$lib/map/types';
import { createLru } from '$lib/sim/lru';
import { scenarioUrls } from '$lib/sim/scenario/load';
import type { TimelineHostRequest, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { createTimelineHost } from './host';
import { off, span, timingSet } from './policy/test/fixtures';
import { viewOf, type ScoreStatics, type SeriesChunk, type TimelineView } from './score';
import { finalTable } from './score/statics';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './runner/dataset';
import { createRunner, type Runner } from './runner/runner';
import { datasetFetch, fakeClock } from './runner/test/harness';
import { FakeController } from './test/map-stream-run';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const MONTHS = 130;

type Msg = TimelineHostResponse;
type Of<T extends Msg['type']> = Extract<Msg, { type: T }>;

let ds: Dataset;
let asOf: Day;
/** Every lot of the fixture, for a painted brush. */
let paintLots: ParcelId[];

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
  paintLots = [...ds.chunks.records.keys()].sort();
});

// --- documents ---

/**
 * The default document plus observed permitting from month 1: something is in force, so the
 * comparison is the default document on the plan, and stays so under every edit below.
 */
function baseDoc(): SimPolicy4 {
  const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
  doc.kinds.permitting.push({
    id: 'observed',
    label: 'observed',
    preset: null,
    on: true,
    where: { tag: 'routes' },
    spans: [span(asOf, 1, null, { tag: 'timing', set: timingSet() })]
  });
  return doc;
}

const protect = (from: number, years: number): Policy => ({
  id: `newer-${years}-${from}`,
  label: 'newer',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'newerThan' },
  spans: [span(asOf, from, null, { tag: 'protect', years })]
});

const PAINT: CustomBrush = {
  id: 'paint',
  kind: 'paint',
  strokes: [{ path: [[-122.419, 37.76]], radiusM: 30 }],
  stories: 20
};

const painted = (from: number): Policy => ({
  id: 'painted',
  label: 'painted',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [span(asOf, from, null, { tag: 'brushes', brushes: [PAINT] })]
});

const paintLotsTable = () => ({ [queryKey(customQuery(PAINT))]: paintLots });

/**
 * A zoning policy whose effect does not match its selector: it needs no lots, so `setPolicy` takes
 * it, and the compiler rejects it (`LeverFormatError`) at month `from`.
 */
const mismatched = (from: number): Policy => ({
  id: 'mismatched',
  label: 'mismatched',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'newerThan' },
  spans: [span(asOf, from, null, { tag: 'brushes', brushes: [] })]
});

function withZoning(doc: SimPolicy4, ...ps: Policy[]): SimPolicy4 {
  const out = structuredClone(doc);
  out.kinds.zoning.push(...ps);
  return out;
}

// --- the runner, driven by a fake clock ---

/** `compileClock`: the compiles read the runner's clock too (the shared dataset's reads 0). */
function makeRunner(tickMs = 0.1, compileClock = false) {
  const clock = fakeClock();
  const posts: Msg[] = [];
  /** Per post: the plan ensemble's quiet flag and its world's month when it was posted. */
  const at: { quiet: boolean; month: number }[] = [];
  /** Per task: the plan ensemble quiet before and after it, and the world-months it stepped. */
  const tasks: { quietBefore: boolean; quiet: boolean; steps: number; planMax: number }[] = [];
  const stepped = () => {
    const { plan, comp } = runner.ensembles();
    let n = 0;
    for (const e of [plan, comp]) n += e?.world?.month ?? 0;
    return n;
  };
  const now = () => {
    clock.tick(tickMs);
    return clock.now();
  };
  const runner: Runner = createRunner({
    dataset: compileClock ? { ...ds, ctx: (m) => ({ ...ds.ctx(m), now }) } : ds,
    post(msg) {
      posts.push(msg);
      const e = runner.ensembles().plan;
      at.push({ quiet: e?.quiet ?? false, month: e?.world?.month ?? -1 });
    },
    now,
    later: (fn, ms) =>
      clock.setTimeout(() => {
        const quietBefore = runner.ensembles().plan?.quiet ?? false;
        const before = stepped();
        fn();
        const p = runner.ensembles().plan;
        const quiet = p?.quiet ?? false;
        const planMax = p?.world?.month ?? -1;
        tasks.push({ quietBefore, quiet, steps: stepped() - before, planMax });
      }, ms),
    warn: () => {},
    logOnce: () => {}
  });
  const of = <T extends Msg['type']>(type: T, from = 0): Of<T>[] =>
    posts.slice(from).flatMap((m) => (m.type === type ? [m as Of<T>] : []));
  const run = (pred: () => boolean) => clock.runUntil(pred, 50_000);
  /** Filled through the last month at `rev`. */
  const full = (rev: number) => () => {
    const c = of('compiled').at(-1);
    const f = of('filled').at(-1);
    return !!c && c.rev === rev && !!f && f.rev === rev && f.through === c.statics.lastIndex;
  };
  const both = (m: number) => () => {
    const { plan, comp } = runner.ensembles();
    return (plan?.month ?? -1) >= m && (comp?.month ?? -1) >= m;
  };
  const errors = () => of('error');
  return { clock, runner, posts, at, tasks, of, run, full, both, errors };
}

/**
 * S14: the one `refill` at `rev`, checked to follow the `compiled` at `rev` with no `filled` at
 * `rev` before it; `kept`: its `from` is the first calendar month not posted before it.
 */
function settledAt(posts: Msg[], rev: number, kept = false): Of<'refill'> {
  const refills = posts.filter((m): m is Of<'refill'> => m.type === 'refill' && m.rev === rev);
  expect(refills).toHaveLength(1);
  const r = posts.indexOf(refills[0]);
  const c = posts.findIndex((m) => m.type === 'compiled' && m.rev === rev);
  expect(c).toBeGreaterThanOrEqual(0);
  expect(c).toBeLessThan(r);
  expect(posts.slice(0, r).some((m) => m.type === 'filled' && m.rev === rev)).toBe(false);
  if (kept) {
    const last = posts
      .slice(0, r)
      .filter((m): m is Of<'filled'> => m.type === 'filled')
      .at(-1);
    expect(refills[0].from).toBe(last === undefined ? 0 : last.through + 1);
  }
  return refills[0];
}

/** Trims a chunk to the months before `n`, or null when it starts at or after `n`. */
function before(c: SeriesChunk, n: number): SeriesChunk | null {
  if (c.from >= n) return null;
  const k = n - c.from;
  return {
    from: c.from,
    rows: c.rows.slice(0, k),
    planEffect: c.planEffect.slice(0, k),
    money: c.money ? c.money.slice(0, k) : null,
    tiers: c.tiers ? c.tiers.slice(0, k) : null
  };
}

/** What a client that applies every `filled` and `refill` in order holds. */
function viewFrom(posts: Msg[]): TimelineView {
  let chunks: SeriesChunk[] = [];
  let statics: ScoreStatics | null = null;
  for (const m of posts) {
    if (m.type === 'compiled') statics = m.statics;
    else if (m.type === 'filled') chunks.push(m.series);
    else if (m.type === 'refill')
      chunks = chunks.flatMap((c) => {
        const t = before(c, m.from);
        return t ? [t] : [];
      });
  }
  return viewOf(chunks, statics!);
}

/** The view of a fresh open of `doc`. */
async function fresh(
  doc: SimPolicy4,
  lots: Record<string, ParcelId[]> = {},
  months = MONTHS
): Promise<TimelineView> {
  const r = makeRunner();
  r.runner.open(1, doc, lots, months);
  await r.run(r.full(1));
  expect(r.errors()).toEqual([]);
  r.runner.dispose();
  return viewFrom(r.posts);
}

function applyAll(updates: TimelineUpdate[]): FakeController {
  const ctl = new FakeController();
  for (const u of updates) ctl.apply(u);
  return ctl;
}

describe('edits', () => {
  it('an edit dated after the fill point posts one refill that withdraws nothing and later months reflect it', async () => {
    // 1 ms per clock read: a slice steps a few months, so the fill stops near month 60
    const r = makeRunner(1);
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(60));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.world;
    expect(plan.steppedThrough).toBeLessThan(70);
    const doc = withZoning(baseDoc(), painted(70));
    const at = r.posts.length;
    r.runner.setPolicy(2, doc, paintLotsTable());
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    // S14: one refill from the first calendar month not posted (last posted + 1)
    expect(r.of('refill')).toHaveLength(1);
    const refill = settledAt(r.posts, 2, true);
    expect(refill.from).toBeGreaterThan(0);
    const after = r.of('filled', r.posts.indexOf(refill));
    expect(after[0].series.from).toBe(refill.from);
    // kept: the same ensemble and world objects, under the new timeline
    expect(r.runner.ensembles().plan).toBe(plan);
    expect(plan.world).toBe(w1);
    expect(r.of('compiled', at).map((c) => c.rev)).toEqual([2]);
    expect(r.of('filled', at).every((f) => f.rev === 2)).toBe(true);
    const view = viewFrom(r.posts);
    expect(view).toEqual(await fresh(doc, paintLotsTable()));
    // the edit is felt
    expect(view).not.toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('an edit at month 100 after filling to 300: one refill from the first month not final at 99, no earlier month reposted, money included, equal to a fresh open', async () => {
    const months = 320;
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, months);
    await r.run(r.both(300));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.world;
    const doc = withZoning(baseDoc(), protect(100, 200));
    const at = r.posts.length;
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    const statics = r.of('compiled').at(-1)!.statics;
    const expected = Array.from(finalTable(statics)).findIndex((mm) => mm > 99);
    expect(expected).toBeGreaterThan(0);
    expect(r.of('refill')).toEqual([{ type: 'refill', rev: 2, from: expected }]);
    settledAt(r.posts, 2);
    const refillAt = r.posts.findIndex((m) => m.type === 'refill');
    const after = r.of('filled', refillAt);
    expect(after[0].series.from).toBe(expected);
    expect(after.every((f) => f.series.from >= expected && f.rev === 2)).toBe(true);
    // nothing between the edit and the refill
    expect(r.of('filled', at).length).toBe(after.length);
    // restored: the plan's world is a new object
    expect(r.runner.ensembles().plan!.world).not.toBe(w1);
    const view = viewFrom(r.posts);
    expect(view.money).not.toBeNull();
    expect(view).toEqual(await fresh(doc, {}, months));
    expect(view).not.toEqual(await fresh(baseDoc(), {}, months));
    r.runner.dispose();
  });

  it('a label-only edit or an added policy that is off: one refill each that withdraws nothing, no change', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(60));
    const plan = r.runner.ensembles().plan!;
    const comp = r.runner.ensembles().comp!;
    const w1 = plan.world;
    const relabelled = baseDoc();
    relabelled.kinds.permitting[0].label = 'renamed';
    r.runner.setPolicy(2, relabelled, {});
    await r.run(() => r.of('compiled').some((c) => c.rev === 2));
    const offDoc = withZoning(baseDoc(), off(protect(1, 41)));
    r.runner.setPolicy(3, offDoc, {});
    await r.run(r.full(3));
    expect(r.errors()).toEqual([]);
    expect(r.of('refill').map((m) => m.rev)).toEqual([2, 3]);
    settledAt(r.posts, 2, true);
    settledAt(r.posts, 3, true);
    expect(r.runner.ensembles().plan).toBe(plan);
    expect(r.runner.ensembles().comp).toBe(comp);
    expect(plan.world).toBe(w1);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('two setPolicy in a row: only the second is reflected, nothing for the first after the second, and every cells update applies in order on a FakeController', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(60));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(10, 41)), {});
    // the first edit is under way: accepted, its world re-stepping quietly
    await r.run(
      () => r.posts.some((m) => 'rev' in m && m.rev === 2) && r.runner.ensembles().plan!.quiet
    );
    const second = withZoning(baseDoc(), protect(30, 43));
    const at = r.posts.length;
    r.runner.setPolicy(3, second, {});
    await r.run(() => r.full(3)() && r.of('cells').at(-1)?.render.complete === true);
    expect(r.errors()).toEqual([]);
    expect(r.posts.slice(at).filter((m) => 'rev' in m && m.rev !== 3)).toEqual([]);
    // S14, superseded: rev 2 was accepted but not settled; the refill at 3 answers both
    expect(r.of('refill').map((m) => m.rev)).toEqual([3]);
    settledAt(r.posts, 3);
    expect(viewFrom(r.posts)).toEqual(await fresh(second));
    const cells = r.of('cells').map((c) => c.render);
    const ctl = applyAll(cells);
    // the map holds what a snapshot of the world says
    const n = r.posts.length;
    r.runner.resyncMap();
    const snap = r.of('cells', n);
    expect(snap).toHaveLength(1);
    expect(snap[0].render.revision).toBe(0);
    expect([...ctl.cells.keys()].sort()).toEqual(snap[0].render.cells.map((c) => c.cellId).sort());
    expect(ctl.demolished).toEqual(
      new Map(snap[0].render.demolish.map((d) => [d.parcelId, d.day]))
    );
    r.runner.dispose();
  });

  it('a rejected document: bad-request at its rev and the previous timeline months keep arriving', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(40));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.world;
    // a brush query missing from `lots`: the compiler rejects month 1
    r.runner.setPolicy(2, withZoning(baseDoc(), painted(1)), {});
    await r.run(() => r.errors().length > 0);
    expect(r.errors()).toEqual([expect.objectContaining({ rev: 2, code: 'bad-request' })]);
    const errAt = r.posts.findIndex((m) => m.type === 'error');
    await r.run(r.full(1));
    expect(r.errors()).toHaveLength(1);
    const after = r.of('filled', errAt);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((f) => f.rev === 1)).toBe(true);
    expect(r.posts.slice(errAt + 1).filter((m) => 'rev' in m && m.rev === 2)).toEqual([]);
    expect(r.of('refill')).toEqual([]);
    expect(plan.world).toBe(w1);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('a comparison that does not change keeps its world', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(60));
    const comp = r.runner.ensembles().comp!;
    const compWorld = comp.world;
    const compTimeline = comp.timeline;
    const plan = r.runner.ensembles().plan!;
    const planW1 = plan.world;
    const doc = withZoning(baseDoc(), protect(10, 41));
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    expect(r.runner.ensembles().comp).toBe(comp);
    expect(comp.timeline).toBe(compTimeline);
    expect(comp.world).toBe(compWorld);
    // the plan restored
    expect(plan.world).not.toBe(planW1);
    expect(r.of('refill')).toHaveLength(1);
    expect(viewFrom(r.posts)).toEqual(await fresh(doc));
    r.runner.dispose();
  });

  it('an edit at month 1 re-creates the world and refills from 0', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(60));
    const doc = withZoning(baseDoc(), protect(1, 41));
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    const statics = r.of('compiled').at(-1)!.statics;
    expect(Array.from(finalTable(statics)).findIndex((mm) => mm > 0)).toBe(0);
    expect(r.of('refill')).toEqual([{ type: 'refill', rev: 2, from: 0 }]);
    settledAt(r.posts, 2);
    const { plan, comp } = r.runner.ensembles();
    expect(plan!.copiedMonths()).toEqual([0]);
    expect(comp!.copiedMonths()).toEqual([0]);
    expect(viewFrom(r.posts)).toEqual(await fresh(doc));
    r.runner.dispose();
  });

  it('a restore whose quiet re-step ends before its compile: the refill waits for the compiled', async () => {
    // 1 ms per clock read and a long window: the month-1 re-creation is over long before the
    // compile reaches the last month
    const months = 400;
    const r = makeRunner(1, true);
    r.runner.open(1, baseDoc(), {}, months);
    await r.run(r.both(60));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(1, 200)), {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    expect(settledAt(r.posts, 2).from).toBe(0);
    r.runner.dispose();
  });

  it('resyncMap during a quiet re-step is answered after it, from the restored world', async () => {
    const r = makeRunner(1);
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(120));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(100, 200)), {});
    await r.run(() => r.runner.ensembles().plan!.quiet);
    const n = r.posts.length;
    r.runner.resyncMap();
    expect(r.posts.length).toBe(n);
    await r.run(() => r.of('cells', n).some((c) => c.render.revision === 0));
    const i = r.posts.findIndex((m, k) => k >= n && m.type === 'cells' && m.render.revision === 0);
    // posted once the plan's world stood at month 99, re-stepped and rewound
    expect(r.at[i]).toEqual({ quiet: false, month: 99 });
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    r.runner.dispose();
  });

  it('the rewind after a quiet re-step is a task of its own, before any loud step', async () => {
    const r = makeRunner(1);
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(120));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(100, 200)), {});
    const from = r.tasks.length;
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    const k = r.tasks.findIndex((t, i) => i >= from && t.quietBefore && !t.quiet);
    expect(k).toBeGreaterThan(from);
    // the quiet re-step's last slice stops with the plan's world at 99; the next task (the
    // rewind) steps nothing
    expect(r.tasks[k + 1].steps).toBe(0);
    expect(r.tasks[k].planMax).toBe(99);
    expect(r.of('refill')).toHaveLength(1);
    r.runner.dispose();
  });

  it('a query missing from lots for a later month is rejected at once; the timelines in use keep filling', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(60));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.world;
    const n = r.posts.length;
    // the compiler would throw only at month 121, after an acceptance at month 60
    r.runner.setPolicy(2, withZoning(baseDoc(), painted(121)), {});
    expect(r.posts.slice(n)).toEqual([
      expect.objectContaining({ type: 'error', rev: 2, code: 'bad-request' })
    ]);
    expect(r.runner.internals().pending).toBeNull();
    await r.run(r.full(1));
    expect(r.errors()).toHaveLength(1);
    expect(r.posts.slice(n + 1).filter((m) => 'rev' in m && m.rev === 2)).toEqual([]);
    expect(r.of('refill')).toEqual([]);
    expect(plan.world).toBe(w1);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('a second setPolicy after the first edit posted compiling but before its acceptance: nothing more at the first rev', async () => {
    // 1 ms per clock read: a compile step assembles about 20 frames, so an edit at fill month
    // 120 takes several slices to be ready
    const r = makeRunner(1, true);
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(120));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(100, 197)), {});
    await r.run(() => r.of('compiling').some((c) => c.rev === 2));
    expect(r.runner.internals().pending).not.toBeNull();
    expect(r.runner.rev).toBe(1);
    const second = withZoning(baseDoc(), protect(30, 43));
    const at = r.posts.length;
    r.runner.setPolicy(3, second, {});
    await r.run(r.full(3));
    expect(r.errors()).toEqual([]);
    expect(r.posts.slice(at).filter((m) => 'rev' in m && m.rev !== 3)).toEqual([]);
    // S14, superseded before acceptance: no refill at 2, one at 3
    expect(r.of('refill').map((m) => m.rev)).toEqual([3]);
    settledAt(r.posts, 3);
    expect(viewFrom(r.posts)).toEqual(await fresh(second));
    r.runner.dispose();
  });

  it('after an edit that restores, the runner holds only the month-0 copies and no superseded timeline or compile', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(120));
    const old = r.runner.internals();
    const oldPlanTimeline = r.runner.ensembles().plan!.timeline;
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(100, 200)), {});
    // a second edit while the first's compile runs: the first is dropped
    r.runner.setPolicy(3, withZoning(baseDoc(), protect(90, 43)), {});
    await r.run(r.full(3));
    expect(r.errors()).toEqual([]);
    const now = r.runner.internals();
    expect(now.pending).toBeNull();
    expect(now.refillAt).toBeNull();
    expect(now.refillDue).toBe(false);
    expect(now.lookedAt).not.toBeNull();
    // one timeline per ensemble, the side's own: the plan's new one, the comparison's kept one
    const { plan, comp } = r.runner.ensembles();
    expect(now.timelines).toEqual([plan!.timeline, comp!.timeline]);
    expect(now.timelines[0]).not.toBe(oldPlanTimeline);
    expect(now.timelines).not.toContain(oldPlanTimeline);
    expect(now.compiles[0]).not.toBe(old.compiles[0]);
    expect(now.compiles[1]).toBe(old.compiles[1]); // D4
    expect(now.owed).toBe(0);
    expect(plan!.copiedMonths()).toEqual([0]);
    expect(comp!.copiedMonths()).toEqual([0]);
    r.runner.dispose();
  });
});

describe('a rejected edit resumes the last accepted one (S14)', () => {
  // R = 2 is still compiling or accepted-and-unsettled when R + 1 = 3 arrives and is rejected:
  // at once (a brush query missing from `lots`) or by the compiler (an effect that does not match)
  const cases = [
    ['compiling', 'at once'],
    ['compiling', 'by the compiler'],
    ['accepted', 'at once'],
    ['accepted', 'by the compiler']
  ] as const;
  for (const [state, how] of cases)
    it(`R ${state}, R + 1 rejected ${how}: bad-request at R + 1, then compiled, refill and fill at R, equal to a fresh open of R`, async () => {
      // 1 ms per clock read: an edit at fill month 120 takes several slices to be ready
      const r = makeRunner(1, true);
      r.runner.open(1, baseDoc(), {}, MONTHS);
      await r.run(r.both(120));
      const docR = withZoning(baseDoc(), protect(100, 197));
      r.runner.setPolicy(2, docR, {});
      if (state === 'compiling') {
        await r.run(() => r.of('compiling').some((c) => c.rev === 2));
        expect(r.runner.internals().pending).not.toBeNull();
        expect(r.runner.rev).toBe(1);
      } else {
        await r.run(() => r.runner.rev === 2 && r.runner.ensembles().plan!.quiet);
        expect(r.of('refill')).toEqual([]);
      }
      const bad =
        how === 'at once'
          ? withZoning(baseDoc(), painted(1))
          : withZoning(baseDoc(), mismatched(1));
      r.runner.setPolicy(3, bad, {});
      await r.run(r.full(2));
      expect(r.errors()).toEqual([expect.objectContaining({ rev: 3, code: 'bad-request' })]);
      const errAt = r.posts.findIndex((m) => m.type === 'error');
      expect(
        r.posts.slice(errAt + 1).some((m) => 'rev' in m && m.rev === 3 && m.type !== 'compiling')
      ).toBe(false);
      expect(r.of('refill').map((m) => m.rev)).toEqual([2]);
      const refill = settledAt(r.posts, 2);
      expect(r.posts.indexOf(refill)).toBeGreaterThan(errAt);
      if (state === 'compiling')
        expect(r.posts.findIndex((m) => m.type === 'compiled' && m.rev === 2)).toBeGreaterThan(
          errAt
        );
      expect(r.runner.rev).toBe(2);
      expect(r.runner.internals().superseded).toBe(0);
      expect(viewFrom(r.posts)).toEqual(await fresh(docR));
      r.runner.dispose();
    });

  it('R superseded while compiling by R + 1 and R + 2, both rejected by the compiler: R is taken up again', async () => {
    const r = makeRunner(1, true);
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.both(120));
    const docR = withZoning(baseDoc(), protect(100, 197));
    r.runner.setPolicy(2, docR, {});
    await r.run(() => r.of('compiling').some((c) => c.rev === 2));
    r.runner.setPolicy(3, withZoning(baseDoc(), mismatched(1)), {});
    r.runner.setPolicy(4, withZoning(baseDoc(), mismatched(2)), {});
    expect(r.runner.internals().superseded).toBe(2);
    await r.run(r.full(2));
    expect(r.errors().map((e) => [e.rev, e.code])).toEqual([
      [4, 'bad-request'],
      [3, 'bad-request']
    ]);
    expect(r.of('refill').map((m) => m.rev)).toEqual([2]);
    settledAt(r.posts, 2);
    expect(viewFrom(r.posts)).toEqual(await fresh(docR));
    r.runner.dispose();
  });
});

describe('a late compile rejection resumes the last accepted edit (S14)', () => {
  // R + 1 is accepted at fill month 120 (ready through the month stepped) and its plan compile
  // rejects it at month 200, after acceptance
  const months = 320;
  const cases = [
    ['settled', 'kept'],
    ['settling', 'kept'],
    ['settled', 'restored']
  ] as const;
  for (const [state, how] of cases)
    it(`R ${state}, R + 1 ${how} then rejected at month 200: bad-request at R + 1, then compiled and refill at R, equal to a fresh open of R`, async () => {
      // 1 ms per clock read: a compile step assembles about 20 frames, so R + 1 is accepted
      // well before its compile reaches month 200
      const r = makeRunner(1, true);
      r.runner.open(1, baseDoc(), {}, months);
      await r.run(r.both(120));
      const docR = withZoning(baseDoc(), protect(100, 197));
      r.runner.setPolicy(2, docR, {});
      if (state === 'settled') await r.run(() => r.of('refill').some((m) => m.rev === 2));
      else {
        await r.run(() => r.runner.rev === 2);
        // settling: accepted, its refill not out yet
        expect(r.of('refill')).toEqual([]);
      }
      // kept: R + 1 differs from R only from month 200; restored: also from month 90, before the
      // month stepped (R's own restore left the world at 99)
      const bad =
        how === 'kept'
          ? withZoning(docR, mismatched(200))
          : withZoning(baseDoc(), protect(90, 197), mismatched(200));
      r.runner.setPolicy(3, bad, {});
      await r.run(() => r.runner.rev === 3);
      expect(r.runner.internals().kept).toBeGreaterThan(0);
      // R + 1's acceptance kept the world, or restored it (a refill is due from month 90)
      if (how === 'restored') expect(r.runner.internals().refillAt).toBe(90);
      else if (state === 'settled') expect(r.runner.internals().refillAt).toBeNull();
      await r.run(() => r.errors().length > 0);
      expect(r.errors()).toEqual([expect.objectContaining({ rev: 3, code: 'bad-request' })]);
      const errAt = r.posts.findIndex((m) => m.type === 'error');
      await r.run(r.full(2));
      // R + 1's plan compile never finished: no compiled and no refill at R + 1, ever
      expect(r.of('compiled').some((c) => c.rev === 3)).toBe(false);
      expect(r.errors()).toHaveLength(1);
      expect(r.runner.rev).toBe(2);
      // nothing at R + 1 after its bad-request; R's compiled and its refill after it
      expect(r.posts.slice(errAt + 1).some((m) => 'rev' in m && m.rev === 3)).toBe(false);
      expect(r.of('refill', errAt).map((m) => m.rev)).toEqual([2]);
      expect(r.of('refill').filter((m) => m.rev === 3)).toEqual([]);
      const refill = settledAt(r.posts.slice(errAt + 1), 2);
      // taken up again, R is accepted afresh: settled before, it now has two compiled and refills
      const twice = state === 'settled' ? 2 : 1;
      expect(r.of('compiled').filter((c) => c.rev === 2)).toHaveLength(twice);
      expect(r.of('refill').filter((m) => m.rev === 2)).toHaveLength(twice);
      // the posted mark before this refill, as a client applying every filled and refill holds it
      let mark = -1;
      for (const m of r.posts.slice(0, r.posts.indexOf(refill)))
        if (m.type === 'filled') mark = m.through;
        else if (m.type === 'refill') mark = Math.min(mark, m.from - 1);
      if (state === 'settled' && how === 'kept') {
        // R + 1 differs from R only from month 200: nothing to withdraw
        expect(refill.from).toBe(mark + 1);
      } else {
        // a restore: R's own (settling) or one undoing R + 1's from month 90
        expect(refill.from).toBeLessThanOrEqual(mark);
      }
      expect(r.runner.internals().kept).toBe(0);
      expect(viewFrom(r.posts)).toEqual(await fresh(docR, {}, months));
      r.runner.dispose();
    });

  it('an open whose own compile rejects it late: nothing to take up, filling stops', async () => {
    const r = makeRunner();
    r.runner.open(1, withZoning(baseDoc(), mismatched(60)), {}, 130);
    await r.run(() => r.errors().length > 0);
    expect(r.errors()).toEqual([expect.objectContaining({ rev: 1, code: 'bad-request' })]);
    expect(r.of('refill')).toEqual([]);
    expect(r.runner.internals().pending).toBeNull();
    r.runner.dispose();
  });
});

describe('refill edge cases (S14)', () => {
  it('an edit after a rejected open: one refill from 0 after its compiled', async () => {
    const r = makeRunner();
    r.runner.open(1, withZoning(baseDoc(), mismatched(1)), {}, MONTHS);
    await r.run(() => r.errors().length > 0);
    expect(r.errors()).toEqual([expect.objectContaining({ rev: 1, code: 'bad-request' })]);
    r.runner.setPolicy(2, baseDoc(), {});
    await r.run(r.full(2));
    expect(r.errors()).toHaveLength(1);
    expect(r.of('refill')).toEqual([{ type: 'refill', rev: 2, from: 0 }]);
    settledAt(r.posts, 2, true);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('a kept edit on a whole window: one refill from the window length, no filled after it', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, MONTHS);
    await r.run(r.full(1));
    const statics = r.of('compiled').at(-1)!.statics;
    const relabelled = baseDoc();
    relabelled.kinds.permitting[0].label = 'renamed';
    r.runner.setPolicy(2, relabelled, {});
    await r.run(() => r.of('refill').length > 0);
    // let every later task post what it would (the stream drains, then nothing is scheduled)
    for (let k = 0; k < 1000 && (await r.clock.runNext()); k++);
    expect(r.errors()).toEqual([]);
    const refill = settledAt(r.posts, 2, true);
    expect(refill.from).toBe(statics.lastIndex + 1);
    expect(r.of('filled', r.posts.indexOf(refill))).toEqual([]);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('a second edit at the same rev: its refill waits for its own compiled', async () => {
    // as the long-window restore above: the month-1 re-creation ends long before the compile
    const months = 400;
    const r = makeRunner(1, true);
    r.runner.open(1, baseDoc(), {}, months);
    await r.run(r.both(60));
    const relabelled = baseDoc();
    relabelled.kinds.permitting[0].label = 'renamed';
    r.runner.setPolicy(2, relabelled, {});
    await r.run(() => r.of('refill').some((m) => m.rev === 2));
    const at = r.posts.length;
    // the host passes an equal rev on (M5 ignores only an older one)
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(1, 200)), {});
    await r.run(() => r.of('refill', at).length > 0 && r.of('compiled', at).length > 0);
    const c = r.posts.findIndex((m, k) => k >= at && m.type === 'compiled');
    const f = r.posts.findIndex((m, k) => k >= at && m.type === 'refill');
    expect(c).toBeLessThan(f);
    expect(r.posts.slice(at, f).some((m) => m.type === 'filled')).toBe(false);
    expect(r.errors()).toEqual([]);
    r.runner.dispose();
  });
});

describe('the host', () => {
  it('setPolicy during load: only the latest rev is compiled and posted, and its refill answers it', async () => {
    const f = datasetFetch(FIXTURE);
    const clock = fakeClock();
    const posts: Msg[] = [];
    const host = createTimelineHost({
      fetch: f.fetch,
      fetchBytes: f.fetchBytes,
      post: (msg) => posts.push(msg),
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (h) => clock.clearTimeout(h),
      now: () => {
        clock.tick(0.1);
        return clock.now();
      },
      retryDelaysMs: [],
      warn: () => {}
    });
    const handle = (req: TimelineHostRequest) => host.handle(req);
    handle({
      type: 'openTimeline',
      rev: 1,
      manifest: f.manifest,
      policy: baseDoc(),
      lots: {},
      months: 40
    });
    const doc3 = withZoning(baseDoc(), protect(10, 41));
    handle({ type: 'setPolicy', rev: 2, policy: withZoning(baseDoc(), protect(5, 43)), lots: {} });
    handle({ type: 'setPolicy', rev: 3, policy: doc3, lots: {} });
    const full = () => {
      const c = posts.filter((m): m is Of<'compiled'> => m.type === 'compiled').at(-1);
      const fl = posts.filter((m): m is Of<'filled'> => m.type === 'filled').at(-1);
      return !!c && !!fl && fl.through === c.statics.lastIndex;
    };
    // the dataset decode runs on the real event loop: wait real turns when no timer is pending
    for (let k = 0; k < 20_000 && !full(); k++)
      if (!(await clock.runNext())) await new Promise((res) => setImmediate(res));
    expect(full()).toBe(true);
    expect(posts.filter((m) => m.type === 'error')).toEqual([]);
    const revs = posts.flatMap((m) => ('rev' in m && m.type !== 'ready' ? [m.rev] : []));
    expect(new Set(revs)).toEqual(new Set([3]));
    expect(posts.filter((m) => m.type === 'compiled')).toHaveLength(1);
    // S14: the edits taken before the load open the session; one refill (from 0) answers them
    expect(posts.filter((m) => m.type === 'refill')).toEqual([{ type: 'refill', rev: 3, from: 0 }]);
    settledAt(posts, 3);
    expect(viewFrom(posts)).toEqual(await fresh(doc3, {}, 40));
    host.dispose();
  });
});
