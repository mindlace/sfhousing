// Rules 2 and 9 under a change of money mid-window: waiting applications re-made, lapsed and
// respelled (world-funding rules 17, 18) never reach the series twice. A lapsed application starts
// no row; each award starts one row and sends one 'award', so funded homes, tiers and the award
// day the tiers read are the funded row's own, in every feed order.
import { beforeAll, describe, expect, it } from 'vitest';
import { tierContext, tierSeries, type TierCtx } from '$lib/sim/scenario/finance-score';
import { miniCalibrationWithRoutes } from '$lib/sim/scenario/fixtures/mini-finance';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { Effect, Policy } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Pool, Programme, TierUnits } from '$lib/timelapse/types';
import { fundOf } from '../funding/columns';
import { createFundingSystem } from '../funding/system';
import { monthOfDay } from '../months';
import { compileTimeline } from '../policy/compile';
import type { PolicyTimeline } from '../policy/frame';
import { miniCompileCtx } from '../policy/test/compile-fixtures';
import { miniDoc, span } from '../policy/test/fixtures';
import { scheduleAt } from '../read';
import { staticsOf, type Statics } from '../statics';
import { ORIGIN_MASTER, type FundingSystem, type World, type WorldEvent } from '../types';
import { createWorldSeries, extrasOf } from './series';
import { horizonOf } from './statics';
import { feedFunded, timelineStatics, type FeedMode } from './test/feed';
import type { ScoreStatics, WorldSeries } from './types';

/** Model months in the window (20 years). */
const W = 240;
/** The added grant's share rises at `RAISE`; it is off from `OFF` through `ON - 1`. */
const RAISE = 13;
const OFF = 25;
const ON = 37;
const TIERS = { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 };

const CTX = miniCompileCtx({ finance: true, windowMonths: W });
/** The mini city whose own programmes open after the run: the added grant is all there is. */
const INPUT: SimInput = (() => {
  const fin = CTX.input.finance!;
  const later = CTX.input.asOf + 100_000;
  return {
    ...CTX.input,
    calibration: miniCalibrationWithRoutes(),
    finance: { ...fin, programmes: fin.programmes.map((g) => ({ ...g, from: later })) }
  };
})();

function pol(id: string, where: Policy['where'], spans: [number, number | null, Effect][]) {
  const p: Policy = {
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: spans.map(([a, b, what]) => span(INPUT.asOf, a, b, what))
  };
  return p;
}

/**
 * An added pool with a grant (test values), its share raised at `RAISE` (every waiting application
 * re-made), off from `OFF` (every waiting application lapses: nothing else is offered) and on again
 * from `ON` (lapsed lots apply again on their new spells).
 */
function timelineOf(): PolicyTimeline {
  const asOf = INPUT.asOf;
  const pool: Pool = {
    id: 'u-x',
    kind: 'generalRevenue',
    label: 'Added pool',
    inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 20_000_000 }],
    uncapped: false,
    debt: null,
    leverage: 1
  };
  const grant = (share: number): Programme => ({
    id: 'u-x-grant',
    label: 'Added grant',
    pool: 'u-x',
    reach: 'affordable',
    instrument: { kind: 'grant', share },
    from: asOf,
    to: null,
    minHomes: 2,
    tiers: { ...TIERS }
  });
  const fund = (share: number): Effect => ({ tag: 'fund', pool, programmes: [grant(share)] });
  const doc = miniDoc(
    pol('t', { tag: 'terms' }, [[1, null, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } }]]),
    pol('f', { tag: 'fund', pool: 'u-x' }, [
      [1, RAISE - 1, fund(0.8)],
      [RAISE, OFF - 1, fund(0.9)],
      [ON, null, fund(0.9)]
    ])
  );
  const c = compileTimeline(doc, {}, { ...CTX, input: INPUT }, 'plan');
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

/** What the funding line did: each change's lapses and re-makes, and each application joining. */
interface Spy {
  /** Applications lapsed or taken off the line by `policyChanged`: (month, lot, kind). */
  lapsed: { month: number; lot: number; kind: number }[];
  /** Waiting applications `policyChanged` re-made (kept, `viewMonth` moved to its month). */
  remade: number;
  /** Applications joining the line: (month, lot, kind, applied day). */
  joined: { month: number; lot: number; kind: number; applied: Day }[];
}

function spied(): { sys: FundingSystem; spy: Spy } {
  const sys = createFundingSystem();
  const spy: Spy = { lapsed: [], remade: 0, joined: [] };
  const changed = sys.policyChanged;
  const apply = sys.apply;
  sys.policyChanged = (ctx) => {
    const has = 'gone' in ctx.world.line;
    const before = has ? structuredClone(fundOf(ctx.world).line) : null;
    changed(ctx);
    if (before === null) return;
    const after = fundOf(ctx.world).line;
    for (let i = 0; i < before.n; i++) {
      if (before.gone[i] === 1) continue;
      if (after.gone[i] === 1)
        spy.lapsed.push({ month: ctx.month, lot: before.lot[i], kind: before.kind[i] });
      else if (after.viewMonth[i] === ctx.month && before.viewMonth[i] !== ctx.month) spy.remade++;
    }
  };
  sys.apply = (ctx, lots) => {
    const from = 'gone' in ctx.world.line ? fundOf(ctx.world).line.n : 0;
    apply(ctx, lots);
    const line = fundOf(ctx.world).line;
    for (let i = from; i < line.n; i++)
      spy.joined.push({
        month: ctx.month,
        lot: line.lot[i],
        kind: line.kind[i],
        applied: line.applied[i]
      });
  };
  return { sys, spy };
}

interface Run {
  series: WorldSeries;
  world: World;
  spy: Spy;
  /** Every event with the model month that sent it. */
  events: { e: WorldEvent; month: number }[];
}

let statics: Statics;
let timeline: PolicyTimeline;
let score: ScoreStatics;

function run(seed: number, mode: FeedMode = 'live'): Run {
  const series = createWorldSeries(score);
  const { sys, spy } = spied();
  const events: Run['events'] = [];
  const got = feedFunded(
    statics,
    timeline,
    seed,
    W,
    series,
    (e, _w, month) => events.push({ e, month }),
    mode,
    sys
  );
  return { series, world: got.world, spy, events };
}

const runs = new Map<number, Run>();
function runOf(seed: number): Run {
  let r = runs.get(seed);
  if (r === undefined) runs.set(seed, (r = run(seed)));
  return r;
}

/** Seeds 1 to 20: 28 lapses, 8 re-makes, 16 awards after a lapse of the lot (2026-11-13). */
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

beforeAll(() => {
  statics = staticsOf(INPUT);
  timeline = timelineOf();
  score = timelineStatics(INPUT, timeline, W);
});

/** The tier context of the programme definitions in force in model month `m`. */
function ctxOf(m: number): TierCtx {
  const f = timeline.frameAt(Math.max(1, m)).finance!;
  return tierContext({
    projects: INPUT.projects,
    finance: { ...INPUT.finance!, pools: f.pools, programmes: f.programmes }
  });
}

const add = (a: TierUnits, b: TierUnits): TierUnits => ({
  veryLow: a.veryLow + b.veryLow,
  low: a.low + b.low,
  moderate: a.moderate + b.moderate,
  aboveModerate: a.aboveModerate + b.aboveModerate,
  unrecorded: a.unrecorded + b.unrecorded
});

describe('a money change mid-window: lapse, re-make and respell', () => {
  it('the money changes at RAISE, OFF and ON; applications are re-made, lapse and apply again', () => {
    expect(timeline.changes()).toEqual(expect.arrayContaining([RAISE, OFF, ON]));
    let lapsed = 0;
    let remade = 0;
    let again = 0;
    let awardedAfter = 0;
    for (const seed of SEEDS) {
      const r = runOf(seed);
      lapsed += r.spy.lapsed.length;
      remade += r.spy.remade;
      for (const l of r.spy.lapsed) {
        // The lot applies again (rule 18), in the month of the lapse or later.
        if (r.spy.joined.some((j) => j.lot === l.lot && j.kind === l.kind && j.month >= l.month))
          again++;
        const award = (x: Run['events'][number]) =>
          x.e.kind === 'award' && x.month >= l.month && lotOf(r.world, x.e.row) === l.lot;
        if (r.events.some(award)) awardedAfter++;
      }
    }
    // Not degenerate: lapses, re-makes, lapsed lots applying again and some of them awarded.
    expect(lapsed).toBeGreaterThan(0);
    expect(remade).toBeGreaterThan(0);
    expect(again).toBeGreaterThan(0);
    expect(awardedAfter).toBeGreaterThan(0);
  });

  it.each(SEEDS)(
    "seed %i: one 'award' per funded row, never for a lapsed application, funded homes once",
    (seed) => {
      const r = runOf(seed);
      const p = r.world.projects;
      const awards = new Map<number, Day[]>();
      const starts = new Map<number, Day>();
      for (const { e } of r.events) {
        if (e.kind === 'award')
          (awards.get(e.row) ?? awards.set(e.row, []).get(e.row)!).push(e.day);
        else if (e.kind === 'start') starts.set(e.row, e.day);
      }
      let funded = 0;
      let homes = 0;
      const H = horizonOf(score);
      for (let row = 0; row < p.n; row++) {
        if (p.origin[row] === ORIGIN_MASTER || p.funded[row] !== 1) {
          expect(awards.has(row)).toBe(false);
          continue;
        }
        funded++;
        // Exactly one award, on the funded row's start day.
        expect(awards.get(row)).toEqual([starts.get(row)]);
        expect(p.applied[row]).toBeLessThanOrEqual(awards.get(row)![0]);
        const sc = scheduleAt(r.world, statics, row, H);
        if (sc && sc.end.kind === 'complete')
          homes += sc.revisions[sc.revisions.length - 1].units - sc.existingUnits;
      }
      expect(funded).toBeGreaterThan(0);
      expect(awards.size).toBe(funded);
      // The series' funded homes: each completed funded row once.
      const last = score.lastIndex;
      expect(extrasOf(r.series).homes(last, last)[0].funded).toBe(homes);
    }
  );

  it.each(SEEDS)(
    "seed %i: an awarded lot's application is the one that applied last before its award",
    (seed) => {
      const r = runOf(seed);
      const p = r.world.projects;
      for (const { e, month } of r.events) {
        if (e.kind !== 'award') continue;
        const lot = lotOf(r.world, e.row);
        const kind = p.kind[e.row];
        // The latest application of this lot and kind joined no later than the award's month.
        const mine = r.spy.joined.filter(
          (j) => j.lot === lot && j.kind === kind && j.month <= month
        );
        expect(mine.length).toBeGreaterThan(0);
        expect(p.applied[e.row]).toBe(mine[mine.length - 1].applied);
      }
    }
  );

  it('some award follows a lapse of the same lot and kind', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const r = runOf(seed);
      const p = r.world.projects;
      for (const { e, month } of r.events) {
        if (e.kind !== 'award') continue;
        const lot = lotOf(r.world, e.row);
        if (r.spy.lapsed.some((l) => l.lot === lot && l.kind === p.kind[e.row] && l.month <= month))
          n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it.each(SEEDS)("seed %i: tiers use each funded row's own award month's definitions", (seed) => {
    const r = runOf(seed);
    const H = horizonOf(score);
    const award = new Map<number, Day>();
    for (const { e } of r.events) if (e.kind === 'award') award.set(e.row, e.day);
    // Schedules grouped by the model month whose programme definitions split them.
    const byMonth = new Map<number, Schedule[]>();
    for (let row = 0; row < r.world.projects.n; row++) {
      const sc = scheduleAt(r.world, statics, row, H);
      if (sc === null) continue;
      const a = award.get(row);
      const m = a === undefined ? 0 : Math.max(1, monthOfDay(INPUT.asOf, a));
      (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(sc);
    }
    let want: TierUnits[] | null = null;
    for (const [m, schedules] of byMonth) {
      const ctx = m === 0 ? tierContext(INPUT) : ctxOf(m);
      const t = tierSeries(schedules, ctx, INPUT.asOf, H, score.months);
      want = want === null ? t : want.map((x, i) => add(x, t[i]));
    }
    expect(extrasOf(r.series).tiers(0, score.lastIndex)).toEqual(want);
  });

  it('live, buffered and after feeds give equal data', () => {
    const last = score.lastIndex;
    const summed = (r: Run) => (r.series.rows(0, last), r.series.data());
    for (const seed of [1, 2]) {
      const live = summed(runOf(seed));
      for (const mode of ['buffered', 'after'] as const)
        expect(summed(run(seed, mode))).toEqual(live);
    }
  });
});

/** The lot index of simulated row `row`. */
function lotOf(w: World, row: number): number {
  return w.projects.src[row];
}
