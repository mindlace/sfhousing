// The timeline host's edits (ensemble-runner Task 6, spec rules 12 to 17, 20; plan D2, D4): keep
// or restore each ensemble after a `setPolicy`, one `refill`, the new `rev`, and what the runner
// still holds afterwards. Fixture-0, 4 worlds, a fake clock that charges compute time.
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
const WORLDS = 4;
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
  /** Per post: the plan ensemble's quiet flag and world 1's month when it was posted. */
  const at: { quiet: boolean; month: number }[] = [];
  /** Per task: the plan ensemble quiet before and after it, and the world-months it stepped. */
  const tasks: { quietBefore: boolean; quiet: boolean; steps: number; planMax: number }[] = [];
  const stepped = () => {
    const { plan, comp } = runner.ensembles();
    let n = 0;
    for (const e of [plan, comp]) for (const w of e?.worlds ?? []) n += w.month;
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
      at.push({ quiet: e?.quiet ?? false, month: e?.worlds[0]?.month ?? -1 });
    },
    now,
    later: (fn, ms) =>
      clock.setTimeout(() => {
        const quietBefore = runner.ensembles().plan?.quiet ?? false;
        const before = stepped();
        fn();
        const p = runner.ensembles().plan;
        const quiet = p?.quiet ?? false;
        const planMax = Math.max(-1, ...(p?.worlds ?? []).map((w) => w.month));
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

/** Trims a chunk to the months before `n`, or null when it starts at or after `n`. */
function before(c: SeriesChunk, n: number): SeriesChunk | null {
  if (c.from >= n) return null;
  const k = n - c.from;
  return {
    from: c.from,
    mean: c.mean.slice(0, k),
    sd: c.sd.slice(0, k),
    shown: c.shown.slice(0, k),
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
  r.runner.open(1, doc, lots, WORLDS, months);
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
  it('an edit dated after the fill point posts no refill and later months reflect it', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(60));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.worlds[0];
    expect(plan.steppedThrough).toBeLessThan(121);
    const doc = withZoning(baseDoc(), painted(121));
    const at = r.posts.length;
    r.runner.setPolicy(2, doc, paintLotsTable());
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    expect(r.of('refill')).toEqual([]);
    // kept: the same ensemble and world objects, under the new timeline
    expect(r.runner.ensembles().plan).toBe(plan);
    expect(plan.worlds[0]).toBe(w1);
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
    r.runner.open(1, baseDoc(), {}, WORLDS, months);
    await r.run(r.both(300));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.worlds[0];
    const doc = withZoning(baseDoc(), protect(100, 200));
    const at = r.posts.length;
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    const statics = r.of('compiled').at(-1)!.statics;
    const expected = Array.from(finalTable(statics)).findIndex((mm) => mm > 99);
    expect(expected).toBeGreaterThan(0);
    expect(r.of('refill')).toEqual([{ type: 'refill', rev: 2, from: expected }]);
    const refillAt = r.posts.findIndex((m) => m.type === 'refill');
    const after = r.of('filled', refillAt);
    expect(after[0].series.from).toBe(expected);
    expect(after.every((f) => f.series.from >= expected && f.rev === 2)).toBe(true);
    // nothing between the edit and the refill
    expect(r.of('filled', at).length).toBe(after.length);
    // restored: world 1 is a new object
    expect(r.runner.ensembles().plan!.worlds[0]).not.toBe(w1);
    const view = viewFrom(r.posts);
    expect(view.money).not.toBeNull();
    expect(view).toEqual(await fresh(doc, {}, months));
    expect(view).not.toEqual(await fresh(baseDoc(), {}, months));
    r.runner.dispose();
  });

  it('a label-only edit or an added policy that is off: no refill, no change', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(60));
    const plan = r.runner.ensembles().plan!;
    const comp = r.runner.ensembles().comp!;
    const w1 = plan.worlds[0];
    const relabelled = baseDoc();
    relabelled.kinds.permitting[0].label = 'renamed';
    r.runner.setPolicy(2, relabelled, {});
    await r.run(() => r.of('compiled').some((c) => c.rev === 2));
    const offDoc = withZoning(baseDoc(), off(protect(1, 41)));
    r.runner.setPolicy(3, offDoc, {});
    await r.run(r.full(3));
    expect(r.errors()).toEqual([]);
    expect(r.of('refill')).toEqual([]);
    expect(r.runner.ensembles().plan).toBe(plan);
    expect(r.runner.ensembles().comp).toBe(comp);
    expect(plan.worlds[0]).toBe(w1);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('two setPolicy in a row: only the second is reflected, nothing for the first after the second, and every cells update applies in order on a FakeController', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(60));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(10, 41)), {});
    // the first edit is under way: accepted, its worlds re-stepping quietly
    await r.run(
      () => r.posts.some((m) => 'rev' in m && m.rev === 2) && r.runner.ensembles().plan!.quiet
    );
    const second = withZoning(baseDoc(), protect(30, 43));
    const at = r.posts.length;
    r.runner.setPolicy(3, second, {});
    await r.run(() => r.full(3)() && r.of('cells').at(-1)?.render.complete === true);
    expect(r.errors()).toEqual([]);
    expect(r.posts.slice(at).filter((m) => 'rev' in m && m.rev !== 3)).toEqual([]);
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
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(40));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.worlds[0];
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
    expect(plan.worlds[0]).toBe(w1);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('a comparison that does not change keeps its worlds', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(60));
    const comp = r.runner.ensembles().comp!;
    const compWorlds = [...comp.worlds];
    const compTimeline = comp.timeline;
    const plan = r.runner.ensembles().plan!;
    const planW1 = plan.worlds[0];
    const doc = withZoning(baseDoc(), protect(10, 41));
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    expect(r.runner.ensembles().comp).toBe(comp);
    expect(comp.timeline).toBe(compTimeline);
    comp.worlds.forEach((w, k) => expect(w).toBe(compWorlds[k]));
    // the plan restored
    expect(plan.worlds[0]).not.toBe(planW1);
    expect(r.of('refill')).toHaveLength(1);
    expect(viewFrom(r.posts)).toEqual(await fresh(doc));
    r.runner.dispose();
  });

  it('an edit at month 1 re-creates the worlds and refills from 0', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(60));
    const doc = withZoning(baseDoc(), protect(1, 41));
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    const statics = r.of('compiled').at(-1)!.statics;
    expect(Array.from(finalTable(statics)).findIndex((mm) => mm > 0)).toBe(0);
    expect(r.of('refill')).toEqual([{ type: 'refill', rev: 2, from: 0 }]);
    const { plan, comp } = r.runner.ensembles();
    expect(plan!.copiedMonths()).toEqual([0]);
    expect(comp!.copiedMonths()).toEqual([0]);
    expect(viewFrom(r.posts)).toEqual(await fresh(doc));
    r.runner.dispose();
  });

  it('resyncMap during a quiet re-step is answered after it, from the restored world', async () => {
    const r = makeRunner(1);
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(120));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(100, 200)), {});
    await r.run(() => r.runner.ensembles().plan!.quiet);
    const n = r.posts.length;
    r.runner.resyncMap();
    expect(r.posts.length).toBe(n);
    await r.run(() => r.of('cells', n).some((c) => c.render.revision === 0));
    const i = r.posts.findIndex((m, k) => k >= n && m.type === 'cells' && m.render.revision === 0);
    // posted once the plan's worlds stood at month 99, re-stepped and rewound
    expect(r.at[i]).toEqual({ quiet: false, month: 99 });
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    r.runner.dispose();
  });

  it('the rewind after a quiet re-step is a task of its own, before any loud step', async () => {
    const r = makeRunner(1);
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(120));
    r.runner.setPolicy(2, withZoning(baseDoc(), protect(100, 200)), {});
    const from = r.tasks.length;
    await r.run(r.full(2));
    expect(r.errors()).toEqual([]);
    const k = r.tasks.findIndex((t, i) => i >= from && t.quietBefore && !t.quiet);
    expect(k).toBeGreaterThan(from);
    // the quiet re-step's last slice stops with every plan world at 99; the next task (the rewind)
    // steps nothing
    expect(r.tasks[k + 1].steps).toBe(0);
    expect(r.tasks[k].planMax).toBe(99);
    expect(r.of('refill')).toHaveLength(1);
    r.runner.dispose();
  });

  it('a query missing from lots for a later month is rejected at once; the timelines in use keep filling', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
    await r.run(r.both(60));
    const plan = r.runner.ensembles().plan!;
    const w1 = plan.worlds[0];
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
    expect(plan.worlds[0]).toBe(w1);
    expect(viewFrom(r.posts)).toEqual(await fresh(baseDoc()));
    r.runner.dispose();
  });

  it('a second setPolicy after the first edit posted compiling but before its acceptance: nothing more at the first rev', async () => {
    // 1 ms per clock read: a compile step assembles about 20 frames, so an edit at fill month
    // 120 takes several slices to be ready
    const r = makeRunner(1, true);
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
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
    expect(viewFrom(r.posts)).toEqual(await fresh(second));
    r.runner.dispose();
  });

  it('after an edit that restores, the runner holds only the month-0 copies and no superseded timeline or compile', async () => {
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, WORLDS, MONTHS);
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

describe('the host', () => {
  it('setPolicy during load: only the latest rev is compiled and posted', async () => {
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
      worlds: WORLDS,
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
    expect(viewFrom(posts)).toEqual(await fresh(doc3, {}, 40));
    host.dispose();
  });
});
