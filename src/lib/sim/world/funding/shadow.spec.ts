// world-funding Task 10: shadow starts and displaced homes (spec rule 20).
import { describe, expect, it } from 'vitest';
import {
  allowedCount,
  capFrom,
  choiceRow,
  mostHomes,
  optionHomes,
  pickOption,
  topHomes
} from '$lib/sim/choice/choose';
import { miniFinance, withFederalYearly } from '$lib/sim/world/fixtures/mini-finance';
import { lineKey } from '$lib/sim/world/rules/funding';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/world/rules/rng';
import { LEGACY_UNCAPPED_DOLLARS } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';
import { addProject, ensureLot, lotRow, revisionsOf } from '../columns';
import { monthFirstDay, monthLastDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { lotEntity, ordinaryStart } from '../rates';
import type { SimInput } from '../input/types';
import { staticsOf } from '../statics';
import { runWorld } from '../test/run';
import {
  LOT_FREE,
  LOT_LIVE,
  NO_DAY,
  ORIGIN_SIM,
  type FundingSystem,
  type StepCtx,
  type StepSink,
  type World,
  type WorldEvent
} from '../types';
import { withFunding } from '../world';
import { joinLine } from './apply';
import { sizeIn } from './clocks';
import { KIND_AFFORDABLE, addShadow, fundOf, poolRowOf, setSpell, spellOf } from './columns';
import { serveLine } from './serve';
import { stepShadows } from './shadow';
import { createFundingSystem } from './system';
import { fundedMini, oneMoneyTimeline, randomFinance, type MonthEvent } from './test/fixtures';

const input = fundedMini();
const statics = staticsOf(input);
const asOf = statics.asOf;
const fin = miniFinance(asOf);
const timeline = oneMoneyTimeline(input, fin);
const T = input.options;
/** The options `lot`'s envelope allows in `input` and its cap. */
const allowedOf = (lot: number) => allowedCount(T, lot, input.parcels.envelopeStories[lot]);
const capOf = (lot: number) => capFrom(input.parcels.fzpCap[lot]);
const AFF = 'm-city-grant,federal-grant';
/** 40 years of model months. */
const MONTHS = 480;

/** One funded run: a seed and a timeline, stepped through `through`. */
interface Case {
  seed: number;
  t: PolicyTimeline;
  through: number;
}

/**
 * The mini city with `miniFinance`, seeds 1 to 12, 20 years; the same with the federal pool at
 * 20,000,000 a year, 20 years, on seeds (14 to 367, picked from 1 to 400 on the option rows) where
 * an award comes before an ordinary start later in its month (T3: rule 16 as amended awards at
 * once while any pool can pay, so few such cases remain); and with the random finances of seeds 31
 * to 40 (`randomFinance`), 40 years, where funded projects exit and their lots start again before
 * the ordinary start their award pre-empted.
 */
const capped = oneMoneyTimeline(input, withFederalYearly(fin, asOf, 20_000_000));
const CASES: Case[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ seed: i + 1, t: timeline, through: 240 })),
  ...[14, 37, 291, 297, 347, 367].map((seed) => ({ seed, t: capped, through: 240 })),
  ...Array.from({ length: 10 }, (_, i) => {
    const finance = randomFinance(31 + i);
    return { seed: 31 + i, t: oneMoneyTimeline({ ...input, finance }, finance), through: MONTHS };
  })
];

/** What a funded start saw of its lot just before it was made. */
interface Seen {
  month: number;
  lot: number;
  row: number;
  day: Day;
  r: Day;
  k: number;
  existing: number;
}

/** The funding system, recording the lot's attempt, free day and existing homes at each award. */
function recording(seen: Seen[]): FundingSystem {
  const base = createFundingSystem();
  return {
    ...base,
    serve(ctx) {
      base.serve({
        ...ctx,
        startProject(lot, day, funded) {
          if (funded !== null) {
            const l = ctx.world.lots;
            const i = lotRow(l, lot);
            seen.push({
              month: ctx.month,
              lot,
              row: ctx.world.projects.n,
              day,
              r: i < 0 ? asOf : l.r[i],
              k: i < 0 ? 0 : l.k[i],
              existing:
                i >= 0 && l.demolished[i] === 1 ? 0 : ctx.frame.view.parcels.existingUnits[lot]
            });
          }
          return ctx.startProject(lot, day, funded);
        }
      });
    }
  };
}

interface Run {
  world: World;
  events: MonthEvent[];
  seen: Seen[];
}

const runs = new Map<Case, Run>();

/** The run of case `c`, every event with its month (memoised). */
function run(c: Case): Run {
  const got = runs.get(c);
  if (got) return got;
  const { seed, t, through } = c;
  const seen: Seen[] = [];
  const events: MonthEvent[] = [];
  let month = 0;
  const out: StepSink = { event: (e) => events.push({ ...e, month }) };
  const core = withFunding(recording(seen));
  const world = core.createWorld(statics, t, seed, out);
  const due = core.planDue(world, statics, t, seed, through);
  for (let m = 1; m <= through; m++) {
    month = m;
    core.step(world, due, statics, t, seed, out);
  }
  const r = { world, events, seen };
  runs.set(c, r);
  return r;
}

/**
 * The oracle: the ordinary start of attempt (r, k) on `lot`, as world-core's rule 6 plans it month
 * by month, and the homes it would have added: the attempt's SIZE draw against the size table of
 * the view of its lot-month's frame, less `existing`. Null when it is not planned through `through`.
 */
function expected(
  seed: number,
  lot: number,
  r: Day,
  k: number,
  existing: number,
  from: number,
  through: number,
  t: PolicyTimeline = timeline
): { month: number; day: Day; units: number | null } | null {
  const sh = seedHash(seed);
  for (let m = from; m <= through; m++) {
    const s = ordinaryStart(statics, t, m, sh, lot, r, k);
    if (s === null || s.month > m) continue;
    expect(s.month).toBe(m);
    const g = t.frameAt(Math.min(s.frameMonth, m));
    const parcels = g.view.parcels;
    const choice = g.view.pre.choice;
    const allowed = allowedCount(choice.t, lot, parcels.envelopeStories[lot]);
    const cap = capFrom(parcels.fzpCap[lot]);
    const cum = new Float32Array(Math.max(1, allowed));
    choiceRow(
      choice,
      g.choiceStep ?? g.view.pre.choiceStep,
      lot,
      allowed,
      cap,
      existing,
      'market',
      cum
    );
    const u = drawOn(streamOf(sh, lotEntity(statics, lot), k), P.SIZE, 0);
    const f = pickOption(cum, allowed, u);
    const units = f < 0 ? null : optionHomes(choice.t, choice.t.offset[lot] + f, cap, existing);
    return { month: m, day: s.day, units: units === null ? null : units - existing };
  }
  return null;
}

const displacedOf = (events: readonly MonthEvent[], row: number) =>
  events.filter((e) => e.kind === 'displaced' && e.row === row);

/**
 * The month a second cost step (cheaper Type I) takes effect in `withCostStep`: on its 6th day,
 * so frames read it from the next month on while starts later in this month fall after it.
 */
const COST_MONTH = 60;

/**
 * `input` with a second price step from day 5 of month `COST_MONTH` (Type I's cost per home halved,
 * Types V and III half as dear again), and `timeline`'s frames carrying it: from the next month each frame reads cost step 1,
 * as a compile sets `choiceStep` from the step in force on the month's first day.
 */
function withCostStep() {
  const choice = input.calibration.choice!;
  const step0 = choice.prices[0];
  const anchors = structuredClone(step0.value.anchors);
  for (const id of ['C', 'D'] as const) anchors[id].costPerHome *= 0.5;
  for (const id of ['A', 'B', 'E'] as const) anchors[id].costPerHome *= 1.5;
  const from = monthFirstDay(asOf, COST_MONTH) + 5;
  const two: SimInput = {
    ...input,
    calibration: {
      ...input.calibration,
      choice: { ...choice, prices: [step0, { from, value: { ...step0.value, anchors } }] }
    }
  };
  const base = oneMoneyTimeline(two, fin);
  const frames = new Map<number, PolicyFrame>();
  const frameAt = (m: number): PolicyFrame => {
    if (m <= COST_MONTH) return base.frameAt(m);
    let f = frames.get(m);
    if (f === undefined) {
      const b = base.frameAt(m);
      f = { ...b, id: frameIdOf(`cost-step-1|${b.id}`), choiceStep: 1 };
      frames.set(m, f);
    }
    return f;
  };
  const changes = [...new Set([...base.changes(), COST_MONTH + 1])].sort((a, b) => a - b);
  const t: PolicyTimeline = {
    frameAt,
    changes: () => changes,
    touched: (m) => (m === COST_MONTH + 1 ? null : base.touched(m)),
    readyThrough: () => Number.MAX_SAFE_INTEGER
  };
  return { input: two, t, from };
}

describe('shadow starts under a second cost step', () => {
  it("a shadow displaces the homes its ordinary start draws (the frame's cost step)", () => {
    const { input: two, t, from } = withCostStep();
    const st = staticsOf(two);
    expect(two.options).toBe(input.options);
    expect(t.frameAt(COST_MONTH).view.pre.byStep).toHaveLength(2);
    let matched = 0;
    // starts on or after the step's day in a month whose frame still reads step 0
    let between = 0;
    // seed 26 displaces on day 7 of month 60, after the step's day under a step-0 frame, and its
    // draw picks another option at step 1 than at step 0
    for (let seed = 1; seed <= 40; seed++) {
      const c: Case = { seed, t, through: 240 };
      const { events, seen } = run(c);
      // the same attempt's ordinary start, made by the world itself on the same frames
      const plain = runWorld(st, t, seed, 240);
      const p = plain.projects;
      for (const a of seen) {
        if (a.k !== 0 || a.r !== asOf) continue;
        const got = events.filter((e) => e.kind === 'displaced' && e.row === a.row);
        if (got.length !== 1 || got[0].month < COST_MONTH) continue;
        const d = got[0] as MonthEvent & { kind: 'displaced'; day: Day; units: number };
        let row = -1;
        for (let q = 0; q < p.n && row < 0; q++)
          if (p.origin[q] === ORIGIN_SIM && p.src[q] === a.lot && p.sub[q] === 0) row = q;
        if (row < 0 || p.existing[row] !== a.existing) continue;
        const first = revisionsOf(p, row, Number.MAX_SAFE_INTEGER)[0];
        expect(first.day).toBe(d.day);
        expect(d.units).toBe(first.units - a.existing);
        matched++;
        if (d.month === COST_MONTH && d.day >= from) between++;
      }
    }
    expect(matched).toBeGreaterThan(0);
    expect(between).toBeGreaterThan(0);
  });
});

describe('shadow starts (rule 20)', () => {
  it('displaces on the ordinary start day, in its month, with the homes that start would have added', () => {
    let displaced = 0;
    let awards = 0;
    for (const c of CASES) {
      const { events, seen } = run(c);
      awards += seen.length;
      for (const a of seen) {
        const want = expected(c.seed, a.lot, a.r, a.k, a.existing, a.month, c.through, c.t);
        const got = displacedOf(events, a.row);
        if (want === null || want.units === null) {
          expect(got).toEqual([]);
          continue;
        }
        expect(got.length).toBe(1);
        const { month, ...e } = got[0];
        expect(month).toBe(want.month);
        expect(e).toEqual({
          kind: 'displaced',
          row: a.row,
          lot: a.lot,
          day: want.day,
          units: want.units
        });
        expect(want.units).toBeGreaterThan(0);
        displaced++;
      }
      // Every displaced event belongs to an award.
      const rows = new Set(seen.map((a) => a.row));
      for (const e of events) if (e.kind === 'displaced') expect(rows.has(e.row)).toBe(true);
    }
    expect(awards).toBeGreaterThan(100);
    expect(displaced).toBeGreaterThan(50);
  });

  it('T3: an ordinary start later in the award month is displaced in that same month', () => {
    let found = 0;
    for (const c of CASES) {
      const { events, seen } = run(c);
      for (const a of seen) {
        const got = displacedOf(events, a.row);
        if (got.length !== 1 || got[0].month !== a.month || !(got[0].day > a.day)) continue;
        // In the award month, after the award's own events.
        const awardAt = events.findIndex((e) => e.kind === 'award' && e.row === a.row);
        const at = events.indexOf(got[0]);
        expect(events[awardAt].month).toBe(a.month);
        expect(at).toBeGreaterThan(awardAt);
        expect(got[0].day).toBeLessThanOrEqual(monthLastDay(asOf, a.month));
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a shadow is never cancelled: the funded project exits and the lot restarts, the shadow still displaces', () => {
    let found = 0;
    for (const c of CASES) {
      const { world, events, seen } = run(c);
      for (const a of seen) {
        const got = displacedOf(events, a.row);
        if (got.length !== 1) continue;
        const at = events.indexOf(got[0]);
        const exit = events.findIndex(
          (e) => e.kind === 'end' && e.row === a.row && e.how === 'exit'
        );
        if (exit < 0 || exit > at) continue;
        // A later start on the same lot, on a later attempt, before the displacement.
        const p = world.projects;
        const again = events.findIndex(
          (e, j) => j > exit && j < at && e.kind === 'start' && p.src[e.row] === a.lot
        );
        if (again < 0) continue;
        const row2 = (events[again] as WorldEvent & { row: number }).row;
        expect(p.sub[row2]).toBeGreaterThan(a.k);
        // The displacement is the funded row's, at the plan of the attempt the award pre-empted.
        const want = expected(c.seed, a.lot, a.r, a.k, a.existing, a.month, c.through, c.t)!;
        expect(got[0]).toMatchObject({ row: a.row, lot: a.lot, day: want.day, month: want.month });
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

const SEED = 7;
const NOWHERE: StepSink = { event() {} };
const day = (m: number, d: number): Day => monthFirstDay(asOf, m) + d;

interface Displaced {
  row: number;
  lot: number;
  day: Day;
  units: number;
  month: number;
}

/**
 * A hand-made `StepCtx` for `month`: `startProject` makes a row on the lot (funded when asked) and
 * makes the lot live; `displace` checks as the core does and records.
 */
function ctxAt(world: World, month: number, log: Displaced[]): StepCtx {
  const firstDay = monthFirstDay(asOf, month);
  const lastDay = monthLastDay(asOf, month);
  return {
    world,
    due: {
      take() {
        throw new Error('no take');
      },
      put() {},
      drop() {}
    },
    statics,
    timeline,
    frame: timeline.frameAt(month),
    month,
    seed: SEED,
    out: NOWHERE,
    firstDay,
    lastDay,
    startProject(lot, _day, funded) {
      const p = world.projects;
      const row = addProject(p);
      p.origin[row] = ORIGIN_SIM;
      p.src[row] = lot;
      p.funded[row] = funded === null ? 0 : 1;
      const l = world.lots;
      const i = ensureLot(l, lot, asOf);
      l.state[i] = LOT_LIVE;
      l.project[i] = row;
      return row;
    },
    displace(row, lot, d, units) {
      const p = world.projects;
      if (p.funded[row] !== 1 || p.src[row] !== lot) throw new Error('not a funded start');
      if (d < firstDay || d > lastDay) throw new RangeError('outside the month');
      log.push({ row, lot, day: d, units, month });
    }
  };
}

/** A new world whose federal pool has received month 1's arrival (ten trillion on `asOf`). */
function freshWorld(): World {
  const w = withFunding(createFundingSystem()).createWorld(statics, timeline, SEED, NOWHERE);
  const { pools } = fundOf(w);
  const q = pools.id.slice(0, pools.n).indexOf('federal');
  if (q >= 0) {
    pools.received[q] = LEGACY_UNCAPPED_DOLLARS;
    pools.moneyDay[q] = statics.asOf;
    pools.moneyMonth[q] = 1;
  }
  return w;
}

/** The most homes an allowed option gives `lot` (as against its own existing homes). */
const topOf = (lot: number) =>
  topHomes(T, lot, allowedOf(lot), capOf(lot), input.parcels.existingUnits[lot]);

/** Free lots (no row in a new world) whose largest allowed option has 2 homes or more, by rank. */
const LOTS = (() => {
  const w = freshWorld();
  const out: number[] = [];
  for (let lot = 0; lot < statics.parcelId.length; lot++) {
    if (lotRow(w.lots, lot) >= 0 || topOf(lot) < 2) continue;
    out.push(lot);
  }
  return out.sort((a, b) => statics.rank[a] - statics.rank[b]);
})();

/** A funded row on `lot` on attempt `k`, standing in for an earlier award. */
function fundedRow(world: World, lot: number, k: number): number {
  const p = world.projects;
  const row = addProject(p);
  p.origin[row] = ORIGIN_SIM;
  p.src[row] = lot;
  p.sub[row] = k;
  p.funded[row] = 1;
  return row;
}

/** An affordable application of `lot` at its most-homes option, applied on `applied`. */
function application(lot: number, applied: Day) {
  const f = mostHomes(T, lot, allowedOf(lot), capOf(lot), input.parcels.existingUnits[lot]);
  const j = T.offset[lot] + f;
  return {
    lot,
    kind: KIND_AFFORDABLE,
    applied,
    keyDay: applied,
    key: lineKey(applied, statics.rank[lot], 'affordable'),
    bundle: AFF,
    f,
    units: optionHomes(T, j, capOf(lot), input.parcels.existingUnits[lot]),
    stories: T.stories[j],
    level: 1,
    viewMonth: 1
  };
}

/** Steps the shadows of `world` from `from` through `through`, every displacement recorded. */
function stepAll(world: World, from: number, through: number): Displaced[] {
  const log: Displaced[] = [];
  for (let m = from; m <= through; m++) stepShadows(ctxAt(world, m, log));
  return log;
}

describe('shadows by hand', () => {
  it('Review Focus 5: attempt k + 1 after an exit has its own clocks; a spell recorded for attempt k is ignored', () => {
    // Attempt 1 was awarded in month 3 (free since r0); its project exited on `exitDay`, freeing
    // the lot on attempt 2, and a spell respelled for attempt 1 is still in the table. Attempt 2
    // is awarded in month 4.
    const r0 = day(3, 0);
    const exitDay = day(3, 20);
    const stale = day(2, 10);
    let checked = 0;
    for (const lot of LOTS) {
      const existing = input.parcels.existingUnits[lot];
      const old = expected(SEED, lot, r0, 1, existing, 4, MONTHS);
      const now = expected(SEED, lot, exitDay, 2, existing, 4, MONTHS);
      const spelled = expected(SEED, lot, stale, 2, existing, 4, MONTHS);
      // Both plans after the award month and with homes, and the stale spell would plan otherwise.
      if (old === null || now === null || old.units === null || now.units === null) continue;
      if (old.month <= 4 || now.month <= 4 || old.day === now.day) continue;
      if (spelled !== null && spelled.day === now.day) continue;
      const world = freshWorld();
      const { line, pools } = fundOf(world);
      const r0Row = fundedRow(world, lot, 1);
      addShadow(line, lot, r0Row, 1, r0, existing);
      const l = world.lots;
      const i = ensureLot(l, lot, asOf);
      l.state[i] = LOT_FREE;
      l.k[i] = 2;
      l.r[i] = exitDay;
      setSpell(line, lot, KIND_AFFORDABLE, 1, stale);
      expect(spellOf(line, lot, KIND_AFFORDABLE, 2)).toBe(NO_DAY);
      joinLine(line, 4, [application(lot, day(4, 2))]);
      pools.received[poolRowOf(pools, 'm-city')] = 1e12;
      const row = world.projects.n;
      serveLine(ctxAt(world, 4, []));
      expect(world.projects.n).toBe(row + 1);
      // The award's shadow: attempt 2, free since the exit day, the existing homes then.
      expect(line.shadowN).toBe(2);
      expect([line.shadowLot[1], line.shadowRow[1], line.shadowK[1], line.shadowR[1]]).toEqual([
        lot,
        row,
        2,
        exitDay
      ]);
      expect(line.shadowExisting[1]).toBe(existing);
      // The old shadow keeps running on attempt 1.
      expect([line.shadowRow[0], line.shadowK[0], line.shadowR[0]]).toEqual([r0Row, 1, r0]);

      const log = stepAll(world, 4, MONTHS);
      const want = [
        { row: r0Row, lot, day: old.day, units: old.units, month: old.month },
        { row, lot, day: now.day, units: now.units, month: now.month }
      ];
      expect(log.length).toBe(2);
      expect(log).toEqual(expect.arrayContaining(want));
      expect(log.map((d) => d.month)).toEqual([...want.map((d) => d.month)].sort((a, b) => a - b));
      expect(line.shadowN).toBe(0);
      checked++;
      if (checked === 3) break;
    }
    expect(checked).toBe(3);
  });

  it('a shadow whose plan month is before the month stepped throws', () => {
    const plan = (lot: number) =>
      expected(SEED, lot, asOf, 0, input.parcels.existingUnits[lot], 1, MONTHS);
    const lot = LOTS.find((lot) => (plan(lot)?.month ?? 0) >= 2);
    expect(lot).toBeDefined();
    const e = plan(lot!)!;
    const world = freshWorld();
    const { line } = fundOf(world);
    addShadow(line, lot!, fundedRow(world, lot!, 0), 0, asOf, input.parcels.existingUnits[lot!]);
    expect(() => stepShadows(ctxAt(world, e.month + 1, []))).toThrow(/before/);
  });

  it('when no option gains a home, the shadow ends in its month without a displacement', () => {
    let checked = 0;
    for (const lot of LOTS) {
      // Existing homes at the lot's largest option: no option gains a home.
      const top = topOf(lot);
      const e = expected(SEED, lot, asOf, 0, top, 1, MONTHS);
      if (e === null || e.month < 2) continue;
      expect(e.units).toBeNull();
      const g = timeline.frameAt(e.month);
      const uS = drawOn(streamOf(seedHash(SEED), lotEntity(statics, lot), 0), P.SIZE, 0);
      expect(sizeIn(g.view, g.choiceStep, lot, top, uS)).toBeNull();
      const world = freshWorld();
      const { line } = fundOf(world);
      addShadow(line, lot, fundedRow(world, lot, 0), 0, asOf, top);
      expect(stepAll(world, 1, e.month - 1)).toEqual([]);
      expect(line.shadowN).toBe(1);
      expect(stepAll(world, e.month, e.month)).toEqual([]);
      expect(line.shadowN).toBe(0);
      checked++;
      if (checked === 3) break;
    }
    expect(checked).toBe(3);
  });

  it.each([true, false])(
    'an award adds its shadow in the one award function (grouped serving: %s)',
    (grouped) => {
      const world = freshWorld();
      const { line, pools } = fundOf(world);
      const lots = LOTS.slice(0, 3);
      joinLine(
        line,
        2,
        lots.map((lot, n) => application(lot, day(2, n)))
      );
      pools.received[poolRowOf(pools, 'm-city')] = 1e12;
      const n0 = world.projects.n;
      serveLine(ctxAt(world, 2, []), { grouped });
      expect(line.shadowN).toBe(3);
      const shadows = Array.from({ length: 3 }, (_, j) => [
        line.shadowLot[j],
        line.shadowRow[j],
        line.shadowK[j],
        line.shadowR[j],
        line.shadowExisting[j],
        line.shadowMonth[j]
      ]);
      // Line order: the rows applied on days 0, 1, 2 are awarded in that order.
      expect(shadows).toEqual(
        lots.map((lot, j) => [lot, n0 + j, 0, asOf, input.parcels.existingUnits[lot], 0])
      );
    }
  );
});
