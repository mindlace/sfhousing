// One side's world (ensemble-runner Task 4) on fixture-0 under the compiled default policy:
// the series against a plain loop of seed 1, the gate's buffered feed, copies, restore and quiet
// re-stepping.
import { beforeAll, describe, expect, it } from 'vitest';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru } from '$lib/sim/lru';
import { simInputUrls } from '$lib/sim/world/input/load';
import type { LedgerEvent } from '$lib/sim/world/types';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { createFundingSystem } from '../funding';
import { fundOf } from '../funding/columns';
import { CLOSE_POOL, closingPolicy } from '../funding/test/fixtures';
import { withFunding } from '../index';
import type { MapStream } from '../map-stream';
import { monthFirstDay, monthOfDay } from '../months';
import { firstDifference } from '../policy/compare';
import { compileTimeline, type CompileCtx } from '../policy/compile';
import { span } from '../policy/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { createWorldSeries, scoreStaticsOf, type ScoreStatics } from '../score';
import type { Statics } from '../statics';
import type { StepSink, World, WorldEvent } from '../types';
import { createChunkSet, loadDataset, type DatasetDeps } from './dataset';
import { COPY_MONTHS, createEnsemble, SEED, type Ensemble, type EnsembleOpts } from './ensemble';
import { datasetFetch } from './test/harness';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const MONTHS = 130;

let statics: Statics;
let timeline: PolicyTimeline;
let score: ScoreStatics;
/** The score statics of a timeline on fixture-0. */
let scoreOf: (t: PolicyTimeline) => ScoreStatics;
let ctx: CompileCtx;

/** The default document plus rent-controlled lots protected from model month `from`. */
function editedAt(from: number): PolicyTimeline {
  const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
  doc.kinds.zoning.push({
    id: 'edit',
    label: 'edit',
    preset: null,
    on: true,
    where: { tag: 'category', category: 'rentControl' },
    spans: [span(ctx.input.asOf, from, null, { tag: 'protect', years: null })]
  });
  const c = compileTimeline(doc, {}, ctx, 'plan');
  expect(c.step(Infinity)).toBe(true);
  const t = c.result();
  expect(firstDifference(timeline, t)).toBe(from);
  return t;
}

/** CLOSE_POOL's one arrival in month 2 (test value): spent, and the pool closed, before month 100. */
const CLOSE_DOLLARS = 3_000_000;

/**
 * The default document plus one `fund` policy adding CLOSE_POOL, one arrival, and CLOSE_GRANT,
 * with every baseline pool scaled to 0: CLOSE_POOL is then the only pool that can pay, so its
 * applications wait on it and it closes (rule 16 as amended awards on whatever pool can pay).
 */
function closingPlan(): PolicyTimeline {
  const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
  const asOf = ctx.input.asOf;
  const pools = timeline.frameAt(1).finance!.pools.map((p) => p.id);
  doc.kinds.money.push({
    id: 'baseline-off',
    label: 'baseline off',
    preset: null,
    on: true,
    where: { tag: 'baseline' },
    spans: [
      span(asOf, 1, null, {
        tag: 'scales',
        entries: pools.map((pool) => ({ pool, from: asOf, scale: 0 }))
      })
    ]
  });
  doc.kinds.money.push(
    closingPolicy(asOf, [
      {
        from: 1,
        to: null,
        inflows: [{ kind: 'once', day: monthFirstDay(asOf, 2), dollars: CLOSE_DOLLARS }]
      }
    ])
  );
  const c = compileTimeline(doc, {}, ctx, 'plan');
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

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
  const ds = await loadDataset(
    manifest,
    simInputUrls(manifest)!,
    createChunkSet(manifest, deps),
    deps,
    createLru<string, GeneratedBuilding | null>(1000),
    { gen: generate, genForUnits: generateForUnits, logOnce: () => {} }
  );
  if ('code' in ds) throw new Error(`load failed: ${ds.code} ${ds.message}`);
  ctx = ds.ctx(MONTHS);
  const c = compileTimeline(DEFAULT_POLICY4, {}, ctx, 'plan');
  expect(c.step(Infinity)).toBe(true);
  statics = ds.statics;
  timeline = c.result();
  scoreOf = (t) =>
    scoreStaticsOf(ds.loaded.fzp, t, 'plan', MONTHS, ds.loaded.projects.rhnaCompletedNet);
  score = scoreOf(timeline);
  // Not vacuous: the fixture city's baseline money reaches the plan world's ledger.
  expect(timeline.frameAt(1).finance).not.toBeNull();
});

/** A stream that counts `onEvent` calls; nothing else is called by the ensemble. */
function recordingStream(): MapStream & { events: number } {
  const s = {
    events: 0,
    onEvent() {
      s.events++;
    },
    flush: () => null,
    rewind() {},
    snapshot: () => {
      throw new Error('not used');
    },
    cellsFor: () => new Set<string>()
  };
  return s;
}

function ensemble(over: Partial<EnsembleOpts> = {}): Ensemble {
  return createEnsemble({
    core: withFunding(createFundingSystem()),
    statics,
    timeline,
    months: MONTHS,
    copyMonths: COPY_MONTHS,
    map: { stream: null },
    ...over
  });
}

/** Runs units until `next()` is null or `stop()` holds; returns the kinds run. */
function run(e: Ensemble, stop: () => boolean = () => false): string[] {
  const kinds: string[] = [];
  for (let k = e.next(); k !== null && !stop(); k = e.next()) {
    kinds.push(k);
    e.unit();
  }
  return kinds;
}

const rowsOf = (e: Ensemble) => e.series!.rows(0, e.series!.finalThrough());

/** Rows, world and ledger of a fresh ensemble run under `t` with the gate open (statics `s`). */
function fresh(t: PolicyTimeline, s: ScoreStatics = score) {
  const e = ensemble({ timeline: t });
  e.setStatics(s);
  run(e);
  return { rows: rowsOf(e), world: structuredClone(e.world), ledger: [...e.ledger!] };
}

const same = (e: Ensemble, ref: ReturnType<typeof fresh>) => {
  expect(e.month).toBe(MONTHS);
  expect(rowsOf(e)).toEqual(ref.rows);
  expect(e.ledger).toEqual(ref.ledger);
  expect(structuredClone(e.world)).toEqual(ref.world);
};

/** Months stepped quietly and loudly by the remaining units. */
function stepsOf(e: Ensemble) {
  const quiet = new Set<number>();
  const loud = new Set<number>();
  for (let k = e.next(); k !== null; k = e.next()) {
    if (k === 'quiet') quiet.add(e.month + 1);
    if (k === 'step') loud.add(e.month + 1);
    e.unit();
  }
  return { quiet: [...quiet], loud: [...loud] };
}
const months = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Plain loop: one funded world on seed 1, a fresh series fed live, and its ledger. */
function plainLoop() {
  const core = withFunding(createFundingSystem());
  const series = createWorldSeries(score);
  const buf: WorldEvent[] = [];
  let world: World | null = null;
  const ledger: LedgerEvent[] = [];
  const sink: StepSink = {
    event: (e) => (world === null ? buf.push(e) : series.add(e, world, statics)),
    ledger: (e) => ledger.push(e)
  };
  const w = core.createWorld(statics, timeline, 1, sink);
  world = w;
  for (const e of buf) series.add(e, w, statics);
  const due = core.planDue(w, statics, timeline, 1, MONTHS);
  for (let m = 1; m <= MONTHS; m++) {
    core.step(w, due, statics, timeline, 1, sink);
    series.stepped(m);
  }
  return { rows: series.rows(0, series.finalThrough()), world: w, ledger };
}

describe('createEnsemble', () => {
  it('the series equal a plain loop of seed 1', () => {
    expect(SEED).toBe(1);
    const e = ensemble();
    e.setStatics(score);
    run(e);
    expect(e.month).toBe(MONTHS);
    expect(e.finalThrough()).toBe(score.lastIndex);
    const ref = plainLoop();
    // Not vacuous: homes complete in the window.
    expect(ref.rows[score.lastIndex].completedNet).toBeGreaterThan(0);
    expect(rowsOf(e)).toEqual(ref.rows);
    expect(structuredClone(e.world)).toEqual(structuredClone(ref.world));
    expect(e.ledger).toEqual(ref.ledger);
  });

  it('one create unit makes the world', () => {
    const e = ensemble();
    expect(e.world).toBeNull();
    expect(e.month).toBe(-1);
    expect(e.next()).toBe('create');
    e.unit();
    expect(e.world).not.toBeNull();
    expect(e.month).toBe(0);
  });

  it('a copy is one unit', () => {
    expect([...COPY_MONTHS]).toEqual([0]);
    const e = ensemble();
    e.unit();
    expect(e.month).toBe(COPY_MONTHS[0]);
    expect(e.next()).toBe('copy');
    e.unit();
    expect(e.copiedMonths()).toEqual([0]);
    const kinds = run(e);
    expect(kinds).not.toContain('copy');
    expect(e.copiedMonths()).toEqual([0]);
  });

  it('steppedThrough after a step is that month', () => {
    const e = ensemble();
    run(e, () => e.month === 10);
    expect(e.steppedThrough).toBe(10);
    e.unit();
    expect(e.month).toBe(11);
    expect(e.steppedThrough).toBe(11);
  });

  it('a second copy month works with no other change', () => {
    const e = ensemble({ copyMonths: [0, 60] });
    e.setStatics(score);
    const ledgerAt: number[] = [];
    run(e, () => {
      if (e.month === 60 && ledgerAt.length === 0) ledgerAt.push(e.ledger!.length);
      return false;
    });
    expect(e.copiedMonths()).toEqual([0, 60]);
    const before = { rows: rowsOf(e), world: structuredClone(e.world), ledger: [...e.ledger!] };

    e.restore(timeline, 101);
    expect(e.month).toBe(60);
    expect(e.ledger!.length).toBe(ledgerAt[0]);
    expect(ledgerAt[0]).toBeGreaterThan(0);
    const quietMonths = new Set<number>();
    for (let k = e.next(); k !== null; k = e.next()) {
      if (k === 'quiet') quietMonths.add(e.month + 1);
      e.unit();
    }
    expect([...quietMonths]).toEqual(Array.from({ length: 40 }, (_, i) => 61 + i));
    expect(e.copiedMonths()).toEqual([0, 60]);
    expect(rowsOf(e)).toEqual(before.rows);
    expect(e.ledger).toEqual(before.ledger);
    expect(structuredClone(e.world)).toEqual(before.world);
  });

  it('restore to month 100 and re-step equals never stopping', () => {
    const e = ensemble();
    e.setStatics(score);
    run(e);
    const before = { rows: rowsOf(e), world: structuredClone(e.world), ledger: [...e.ledger!] };

    e.restore(timeline, 101);
    expect(e.quiet).toBe(true);
    const quietMonths = new Set<number>();
    const loudMonths = new Set<number>();
    for (let k = e.next(); k !== null; k = e.next()) {
      if (k === 'quiet' || k === 'step') {
        expect(e.quiet).toBe(k === 'quiet');
        (k === 'quiet' ? quietMonths : loudMonths).add(e.month + 1);
      }
      e.unit();
    }
    expect(e.quiet).toBe(false);
    expect([...quietMonths]).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect([...loudMonths]).toEqual(Array.from({ length: 30 }, (_, i) => i + 101));
    expect(e.month).toBe(MONTHS);
    expect(rowsOf(e)).toEqual(before.rows);
    expect(e.ledger).toEqual(before.ledger);
    expect(structuredClone(e.world)).toEqual(before.world);
  });

  it("restore cuts the plan world's ledger to its length at the copy", () => {
    const e = ensemble();
    run(e);
    expect(e.ledger!.length).toBeGreaterThan(0);
    const ledger = e.ledger;
    e.restore(timeline, 61);
    // The month-0 copy: createWorld sends no ledger entries.
    expect(e.ledger).toBe(ledger);
    expect(e.ledger!.length).toBe(0);
  });

  it('quiet steps do not reach the map stream', () => {
    const stream = recordingStream();
    let onEvent = 0;
    const e = ensemble({ map: { stream, onEvent: () => onEvent++ } });
    run(e);
    expect(stream.events).toBeGreaterThan(0);
    expect(onEvent).toBe(stream.events);
    const loud = stream.events;
    e.restore(timeline, 101);
    let quietUnits = 0;
    for (let k = e.next(); k !== null && e.quiet; k = e.next()) {
      e.unit();
      quietUnits++;
    }
    expect(quietUnits).toBeGreaterThan(0);
    expect(stream.events).toBe(loud);
    expect(onEvent).toBe(loud);
    run(e);
    expect(stream.events).toBeGreaterThan(loud);
  });

  it('the gate buffers and replays exactly', () => {
    const early = ensemble();
    early.setStatics(score);
    run(early);
    const late = ensemble();
    expect(late.finalThrough()).toBe(-1);
    run(late, () => late.month === 50);
    expect(late.finalThrough()).toBe(-1);
    late.setStatics(score);
    run(late);
    expect(late.finalThrough()).toBe(score.lastIndex);
    expect(rowsOf(late)).toEqual(rowsOf(early));
  });

  it('closing and reopening the gate keeps the series', () => {
    const open = ensemble();
    open.setStatics(score);
    run(open);
    const e = ensemble();
    e.setStatics(score);
    run(e, () => e.month === 40);
    e.setStatics(null);
    expect(e.series).toBeNull();
    run(e, () => e.month === 80);
    e.setStatics(score);
    run(e);
    expect(rowsOf(e)).toEqual(rowsOf(open));
  });

  it('a step throws when the next frame is not ready', () => {
    let ready = 0;
    const stub: PolicyTimeline = {
      frameAt: (m) => timeline.frameAt(m),
      changes: () => timeline.changes(),
      touched: (m) => timeline.touched(m),
      readyThrough: () => ready
    };
    const e = ensemble({ timeline: stub });
    expect(e.next()).toBeNull();
    expect(() => e.unit()).toThrow();
    ready = 1;
    run(e);
    expect(e.month).toBe(1);
    ready = 5;
    run(e);
    expect(e.month).toBe(5);
    expect(e.next()).toBeNull();
    expect(() => e.unit()).toThrow();
  });

  it('keep carries on under the new timeline', () => {
    const e = ensemble();
    run(e, () => e.month === 30);
    const other: PolicyTimeline = { ...timeline };
    e.keep(other);
    expect(e.timeline).toBe(other);
    run(e);
    expect(e.month).toBe(MONTHS);
  });

  it('a restore before the month-0 copy starts the world again', () => {
    const ref = ensemble();
    ref.setStatics(score);
    run(ref);
    const e = ensemble();
    e.setStatics(score);
    e.unit();
    expect(e.next()).toBe('copy');
    e.restore(timeline, 1);
    expect(e.month).toBe(-1);
    run(e);
    expect(rowsOf(e)).toEqual(rowsOf(ref));
    expect(e.ledger).toEqual(ref.ledger);
  });
  it('an edit during quiet re-stepping, after the quiet month reached, ends quiet before it', () => {
    const t2 = editedAt(90);
    const ref = fresh(t2);
    const stream = recordingStream();
    const e = ensemble({ map: { stream } });
    e.setStatics(score);
    run(e);
    e.restore(timeline, 101);
    run(e, () => e.month === 30);
    expect(e.quiet).toBe(true);
    expect(e.steppedThrough).toBe(100);
    const before = stream.events;
    e.restore(t2, 90);
    const quietUnits = (() => {
      let n = 0;
      for (let k = e.next(); k !== null && e.quiet; k = e.next()) {
        expect(k === 'quiet' || k === 'feed').toBe(true);
        e.unit();
        n++;
      }
      return n;
    })();
    expect(quietUnits).toBeGreaterThan(0);
    expect(e.month).toBe(89);
    expect(stream.events).toBe(before);
    const s = stepsOf(e);
    expect(s.quiet).toEqual([]);
    expect(s.loud).toEqual(months(90, MONTHS));
    same(e, ref);
  });

  it('an edit during quiet re-stepping, before the quiet month reached, restores', () => {
    const t2 = editedAt(40);
    const ref = fresh(t2);
    const e = ensemble({ copyMonths: [0, 20] });
    e.setStatics(score);
    run(e);
    e.restore(timeline, 101);
    expect(e.month).toBe(20);
    run(e, () => e.month === 50);
    expect(e.quiet).toBe(true);
    e.restore(t2, 40);
    expect(e.month).toBe(20);
    const s = stepsOf(e);
    expect(s.quiet).toEqual(months(21, 39));
    expect(s.loud).toEqual(months(40, MONTHS));
    same(e, ref);
  });

  it('an edit at month 1 creates the world again, quietly', () => {
    const t2 = editedAt(1);
    const ref = fresh(t2);
    const stream = recordingStream();
    const e = ensemble({ map: { stream } });
    e.setStatics(score);
    run(e, () => e.month === 10);
    expect(e.steppedThrough).toBe(10);
    const before = stream.events;
    e.restore(t2, 1);
    expect(e.month).toBe(-1);
    expect(e.quiet).toBe(true);
    run(e, () => e.month === 0 && e.next() === 'step');
    expect(stream.events).toBe(before);
    run(e);
    expect(stream.events).toBeGreaterThan(before);
    same(e, ref);
  });

  it('restore refuses a month after steppedThrough', () => {
    const e = ensemble();
    run(e, () => e.month === 10);
    expect(() => e.restore(timeline, 12)).toThrow(RangeError);
  });

  it('a feed unit drains at most one stepped month', () => {
    const e = ensemble();
    run(e, () => e.month === 50);
    e.setStatics(score);
    let feeds = 0;
    while (e.next() === 'feed') {
      e.unit();
      feeds++;
    }
    expect(feeds).toBe(50);
    expect(e.next()).toBe('step');
  });

  it('a closing is made again after a restore before it, and carried on by keep after it', () => {
    const t = closingPlan();
    const s = scoreOf(t);
    const ref = fresh(t, s);
    const p = fundOf(ref.world!).pools;
    expect(p.shutN).toBeGreaterThan(0);
    expect(p.id[p.shutRow[0]]).toBe(CLOSE_POOL);
    const c = monthOfDay(statics.asOf, p.shutFrom[0] - 1); // the month that found it spent
    expect(c).toBeLessThan(100);
    const r = ensemble({ timeline: t });
    r.setStatics(s);
    run(r);
    r.restore({ ...t }, c - 1);
    run(r);
    same(r, ref);
    const k = ensemble({ timeline: t });
    k.setStatics(s);
    run(k, () => k.month === c + 2);
    k.keep({ ...t });
    run(k);
    same(k, ref);
  });
});
