// One ensemble of worlds (ensemble-runner Task 4) on fixture-0 under the compiled default policy:
// the series against a plain loop, the gate's buffered feed, copies, restore and quiet re-stepping.
import { beforeAll, describe, expect, it } from 'vitest';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru } from '$lib/sim/lru';
import { scenarioUrls } from '$lib/sim/scenario/load';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { createFundingSystem } from '../funding';
import { withFunding } from '../index';
import type { MapStream } from '../map-stream';
import { firstDifference } from '../policy/compare';
import { compileTimeline, type CompileCtx } from '../policy/compile';
import { span } from '../policy/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { createWorldSeries, scoreStaticsOf, type ScoreStatics } from '../score';
import type { Statics } from '../statics';
import type { StepSink, World, WorldEvent } from '../types';
import { createChunkSet, loadDataset, type DatasetDeps } from './dataset';
import { COPY_MONTHS, createEnsemble, type Ensemble, type EnsembleOpts } from './ensemble';
import { datasetFetch } from './test/harness';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const MONTHS = 130;
const WORLDS = 4;

let statics: Statics;
let timeline: PolicyTimeline;
let score: ScoreStatics;
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
    scenarioUrls(manifest)!,
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
  score = scoreStaticsOf(
    ds.loaded.fzp,
    timeline,
    'plan',
    MONTHS,
    ds.loaded.projects.rhnaCompletedNet
  );
  // Not vacuous: the fixture city's baseline money reaches world 1's ledger.
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
    statics,
    timeline,
    worlds: WORLDS,
    months: MONTHS,
    copyMonths: COPY_MONTHS,
    world1: { stream: null },
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

const rowsOf = (e: Ensemble) => e.series.map((s) => s!.rows(0, s!.finalThrough()));

/** Rows, worlds and ledger of a fresh ensemble run under `t` with the gate open. */
function fresh(t: PolicyTimeline) {
  const e = ensemble({ timeline: t });
  e.setStatics(score);
  run(e);
  return { rows: rowsOf(e), worlds: structuredClone(e.worlds), ledger: [...e.ledger!] };
}

const same = (e: Ensemble, ref: ReturnType<typeof fresh>) => {
  expect(e.month).toBe(MONTHS);
  expect(rowsOf(e)).toEqual(ref.rows);
  expect(e.ledger).toEqual(ref.ledger);
  expect(structuredClone(e.worlds)).toEqual(ref.worlds);
};

/** Runs to month `m` with `k` worlds (0 < k < WORLDS) already past it: mid-month. */
function midMonth(e: Ensemble, m: number, k: number) {
  let past = -1;
  run(e, () => {
    const kind = e.next();
    if (e.month === m && (kind === 'step' || kind === 'quiet')) past++;
    return past === k;
  });
  expect(e.month).toBe(m);
  expect(e.steppedThrough).toBeGreaterThanOrEqual(m + 1);
}

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

/** Plain loop: one funded world per seed, a fresh series fed live, the ledger of seed 1. */
function plainLoop(worlds: number) {
  const core = withFunding(createFundingSystem());
  const rows = [];
  const out: World[] = [];
  let ledger: LedgerEvent[] = [];
  for (let seed = 1; seed <= worlds; seed++) {
    const series = createWorldSeries(score);
    const buf: WorldEvent[] = [];
    let world: World | null = null;
    const led: LedgerEvent[] = [];
    const sink: StepSink = {
      event: (e) => (world === null ? buf.push(e) : series.add(e, world, statics)),
      ledger: (e) => led.push(e)
    };
    const w = core.createWorld(statics, timeline, seed, sink);
    world = w;
    for (const e of buf) series.add(e, w, statics);
    const due = core.planDue(w, statics, timeline, seed, MONTHS);
    for (let m = 1; m <= MONTHS; m++) {
      core.step(w, due, statics, timeline, seed, sink);
      series.stepped(m);
    }
    rows.push(series.rows(0, series.finalThrough()));
    out.push(w);
    if (seed === 1) ledger = led;
  }
  return { rows, worlds: out, ledger };
}

describe('createEnsemble', () => {
  it('series equal a plain loop', () => {
    const e = ensemble({ worlds: 8 });
    e.setStatics(score);
    run(e);
    expect(e.month).toBe(MONTHS);
    expect(e.finalThrough()).toBe(score.lastIndex);
    const ref = plainLoop(8);
    // Not vacuous: homes complete in the window.
    expect(ref.rows[0][score.lastIndex].completedNet).toBeGreaterThan(0);
    expect(rowsOf(e)).toEqual(ref.rows);
    expect(e.ledger).toEqual(ref.ledger);
  });

  it('copies are taken at the months COPY_MONTHS lists', () => {
    expect([...COPY_MONTHS]).toEqual([0]);
    const e = ensemble();
    const kinds = run(e);
    expect(e.copiedMonths()).toEqual([0]);
    // One copy unit per world, never all worlds in one unit.
    expect(kinds.filter((k) => k === 'copy')).toHaveLength(WORLDS);
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
    const before = { rows: rowsOf(e), worlds: structuredClone(e.worlds), ledger: [...e.ledger!] };

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
    expect(structuredClone(e.worlds)).toEqual(before.worlds);
  });

  it('restore to month 100 and re-step equals never stopping', () => {
    const e = ensemble();
    e.setStatics(score);
    run(e);
    const before = { rows: rowsOf(e), worlds: structuredClone(e.worlds), ledger: [...e.ledger!] };

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
    expect(structuredClone(e.worlds)).toEqual(before.worlds);
  });

  it("restore cuts world 1's ledger to its length at the copy", () => {
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
    const e = ensemble({ world1: { stream, onEvent: () => onEvent++ } });
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
    expect(e.series.every((s) => s === null)).toBe(true);
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

  it('a restore before the month-0 copy starts the worlds again', () => {
    const ref = ensemble();
    ref.setStatics(score);
    run(ref);
    const e = ensemble();
    e.setStatics(score);
    e.unit();
    e.unit();
    expect(e.next()).toBe('create');
    e.restore(timeline, 1);
    expect(e.month).toBe(-1);
    run(e);
    expect(rowsOf(e)).toEqual(rowsOf(ref));
    expect(e.ledger).toEqual(ref.ledger);
  });
  it('an edit at a month some worlds have stepped restores (mid-month)', () => {
    const t2 = editedAt(31);
    const ref = fresh(t2);
    // Not vacuous: the edit changes the results.
    expect(ref.rows).not.toEqual(fresh(timeline).rows);
    const e = ensemble();
    e.setStatics(score);
    midMonth(e, 30, 2);
    expect(e.steppedThrough).toBe(31);
    e.restore(t2, 31);
    expect(e.month).toBe(0);
    const s = stepsOf(e);
    expect(s.quiet).toEqual(months(1, 30));
    same(e, ref);
  });

  it('an edit after a month some worlds have stepped keeps (mid-month)', () => {
    const t2 = editedAt(32);
    const ref = fresh(t2);
    expect(ref.rows).not.toEqual(fresh(timeline).rows);
    const e = ensemble();
    e.setStatics(score);
    midMonth(e, 30, 2);
    expect(e.steppedThrough).toBe(31);
    e.keep(t2);
    run(e);
    same(e, ref);
  });

  it('an edit during quiet re-stepping, after the quiet month reached, ends quiet before it', () => {
    const t2 = editedAt(90);
    const ref = fresh(t2);
    const stream = recordingStream();
    const e = ensemble({ world1: { stream } });
    e.setStatics(score);
    run(e);
    e.restore(timeline, 101);
    midMonth(e, 30, 1);
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
    midMonth(e, 50, 3);
    e.restore(t2, 40);
    expect(e.month).toBe(20);
    const s = stepsOf(e);
    expect(s.quiet).toEqual(months(21, 39));
    expect(s.loud).toEqual(months(40, MONTHS));
    same(e, ref);
  });

  it('an edit at month 1 creates the worlds again, quietly', () => {
    const t2 = editedAt(1);
    const ref = fresh(t2);
    const stream = recordingStream();
    const e = ensemble({ world1: { stream } });
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
    expect(feeds).toBe(WORLDS * 50);
    expect(e.next()).toBe('step');
  });
});
