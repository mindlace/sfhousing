// Rules 2 and 9 on funded worlds: world 1's pool series are `poolSeries` of its ledger by
// calendar month, `fundedHomes` is `moneyOf`'s, `displacedHomes` counts each 'displaced' event in
// its own month (today counts them when the funded project completes), and money in a chunk is
// world 1's alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { displacedShare, moneyOf, perAddedHome, poolSeries } from '$lib/sim/scenario/finance-score';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { monthIndexer, monthsOf } from '$lib/sim/scenario/score';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { benchFunded } from '../funding/test/cities.node';
import { fundedMini, oneMoneyTimeline } from '../funding/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { readAll } from '../test/run';
import type { World, WorldEvent } from '../types';
import { chunkOf } from './chunk';
import { moneyRowsOf } from './money';
import { createWorldSeries, extrasOf } from './series';
import { feedFunded, timelineStatics } from './test/feed';
import { viewOf } from './view';
import type { MoneyFeed, ScoreStatics, WorldSeries } from './types';

type Finance = NonNullable<SimInput['finance']>;

/** The last day of calendar month `i` from the dataset month. */
const lastDay = (asOf: Day, i: number): Day => addMonths(firstOfMonth(asOf), i + 1) - 1;

type Displaced = Extract<WorldEvent, { kind: 'displaced' }>;

interface Run {
  series: WorldSeries;
  world: World;
  ledger: LedgerEvent[];
  feed: MoneyFeed;
  /** Every 'displaced' event, in the order sent. */
  displaced: Displaced[];
  /** Each row's completion day. */
  completed: Map<number, Day>;
}

interface City {
  input: SimInput;
  fin: Finance;
  statics: Statics;
  timeline: PolicyTimeline;
  score: ScoreStatics;
  months: number;
}

function cityOf(input: SimInput, months: number): City {
  const fin = input.finance!;
  const timeline = oneMoneyTimeline(input, fin);
  return {
    input,
    fin,
    statics: staticsOf(input),
    timeline,
    score: timelineStatics(input, timeline, months),
    months
  };
}

function run(c: City, seed: number, onEvent?: (e: WorldEvent, w: World) => void): Run {
  const series = createWorldSeries(c.score);
  const displaced: Displaced[] = [];
  const completed = new Map<number, Day>();
  const got = feedFunded(c.statics, c.timeline, seed, c.months, series, (e, w) => {
    if (e.kind === 'displaced') displaced.push(e);
    else if (e.kind === 'end' && e.how === 'complete') completed.set(e.row, e.day);
    onEvent?.(e, w);
  });
  const feed: MoneyFeed = {
    ledger: got.ledger,
    finance: c.timeline.frameAt(1).finance!,
    world: got.world,
    statics: c.statics
  };
  return { series, ...got, feed, displaced, completed };
}

/** `moneyOf` over the schedules read on the last final day and the same ledger. */
function today(c: City, r: Run, through: number) {
  const horizon = lastDay(c.input.asOf, through);
  return moneyOf({
    ledger: r.ledger,
    schedules: readAll(r.world, c.statics, horizon).schedules,
    finance: c.fin,
    baseline: [],
    asOf: c.input.asOf,
    horizon,
    months: monthsOf(c.input.asOf, horizon)
  });
}

function checkPools(c: City, r: Run): void {
  const through = r.series.finalThrough();
  const got = moneyRowsOf(r.feed, extrasOf(r.series), 0, through);
  const horizon = lastDay(c.input.asOf, through);
  const want = poolSeries(r.ledger, c.fin, monthsOf(c.input.asOf, horizon), horizon);
  expect(got).toHaveLength(through + 1);
  for (let i = 0; i <= through; i++) {
    expect(got[i].pools).toEqual(
      want.map((q) => ({
        id: q.id,
        label: q.label,
        kind: q.kind,
        received: q.received[i],
        committed: q.committed[i],
        out: q.out[i],
        spent: q.spent[i],
        repaid: q.repaid[i],
        lost: q.lost[i],
        lostCredit: q.lostCredit[i]
      }))
    );
  }
}

function checkHomes(c: City, r: Run): number {
  const through = r.series.finalThrough();
  const got = moneyRowsOf(r.feed, extrasOf(r.series), 0, through);
  const want = today(c, r, through);
  expect(got.map((m) => m.fundedHomes)).toEqual(want.fundedHomes);
  expect(got.map((m) => m.publicSpent)).toEqual(want.publicSpent);
  // `displacedHomes` differs from `moneyOf`'s by design (rule 2): see `checkDisplaced`.
  // Rule 12's term: the displaced homes of funded projects completed by then, `moneyOf`'s.
  expect(got[through].displacedHomesCompleted).toBe(want.displacedHomes[through]);
  // Not degenerate: world-funding's shadows send 'displaced' events.
  expect(checkDisplaced(c, r, got, want.displacedHomes).length).toBeGreaterThan(0);
  return want.fundedHomes[through];
}

/** The calendar month of each day through the last day of final month `through`. */
function monthOfDayIn(c: City, through: number): (d: Day) => number {
  const horizon = lastDay(c.input.asOf, through);
  const idx = monthIndexer(monthsOf(c.input.asOf, horizon), horizon);
  const m0 = firstOfMonth(c.input.asOf);
  return (d) => idx(Math.max(d, m0));
}

/**
 * Rule 2 against the events: month by month, `displacedHomes` is the running sum of the
 * 'displaced' events by their own calendar month. At the horizon it is also `moneyOf`'s (which
 * counts a completed funded row's displaced homes as of the horizon, in its completion month) plus
 * the displaced homes of funded rows not completed by then. Returns the events within the horizon.
 */
function checkDisplaced(
  c: City,
  r: Run,
  got: { displacedHomes: number }[],
  today: number[]
): Displaced[] {
  const through = got.length - 1;
  const horizon = lastDay(c.input.asOf, through);
  const monthOf = monthOfDayIn(c, through);
  const events = r.displaced.filter((e) => e.day <= horizon);
  const want = new Array<number>(through + 1).fill(0);
  for (const e of events) want[monthOf(e.day)] += e.units;
  for (let i = 1; i <= through; i++) want[i] += want[i - 1];
  expect(got.map((m) => m.displacedHomes)).toEqual(want);
  let open = 0;
  for (const e of events) {
    const done = r.completed.get(e.row);
    if (done === undefined || done > horizon) open += e.units;
  }
  expect(got[through].displacedHomes).toBe(today[through] + open);
  return events;
}

describe('world 1 money, funded mini', () => {
  let c: City;
  const runs = new Map<number, Run>();
  const runOf = (seed: number) => {
    let r = runs.get(seed);
    if (r === undefined) runs.set(seed, (r = run(c, seed)));
    return r;
  };
  beforeAll(() => {
    c = cityOf(fundedMini(), 480);
  });

  it.each([1, 2, 3])('seed %i: pool series equal poolSeries of the same ledger', (seed) => {
    const r = runOf(seed);
    expect(r.series.finalThrough()).toBe(c.score.lastIndex);
    expect(r.ledger.some((e) => e.kind === 'spend')).toBe(true);
    checkPools(c, r);
  });

  it.each([1, 2, 3])("seed %i: fundedHomes equals moneyOf's at every month", (seed) => {
    expect(checkHomes(c, runOf(seed))).toBeGreaterThan(0);
  });

  it('a slice from..through equals the same months of 0..finalThrough', () => {
    const r = runOf(1);
    const all = moneyRowsOf(r.feed, extrasOf(r.series), 0, r.series.finalThrough());
    expect(moneyRowsOf(r.feed, extrasOf(r.series), 37, 120)).toEqual(all.slice(37, 121));
  });

  it("a funded completion counts though its 'award' comes after the row's stage events", () => {
    // The award's 'award' event follows the chain `startProject` begins, so the series reads
    // funding from the row's `funded` column, which `startRow` sets before the row's 'start'.
    const order = new Map<number, string[]>();
    const fundedAt = new Map<number, number[]>();
    const r = run(c, 1, (e, w) => {
      if (e.kind === 'start' || e.kind === 'award' || (e.kind === 'end' && e.how === 'complete')) {
        const k = e.kind === 'end' ? 'complete' : e.kind;
        (order.get(e.row) ?? order.set(e.row, []).get(e.row)!).push(k);
        (fundedAt.get(e.row) ?? fundedAt.set(e.row, []).get(e.row)!).push(w.projects.funded[e.row]);
      }
    });
    const awarded = [...order].filter(([, ks]) => ks.includes('award'));
    expect(awarded.length).toBeGreaterThan(0);
    let completed = 0;
    for (const [row, ks] of awarded) {
      expect(ks.indexOf('start')).toBeLessThan(ks.indexOf('award'));
      expect(r.world.projects.funded[row]).toBe(1);
      // `funded` is already 1 at the row's 'start' and at its completion.
      expect(fundedAt.get(row)!.every((f) => f === 1)).toBe(true);
      if (ks.includes('complete')) completed++;
    }
    expect(completed).toBeGreaterThan(0);
    // And every funded row was awarded: no funded row lacks its 'award'.
    for (let row = 0; row < r.world.projects.n; row++) {
      if (r.world.projects.funded[row] === 1) expect(order.get(row)).toContain('award');
    }
    expect(checkHomes(c, r)).toBeGreaterThan(0);
  });

  it('money in a chunk describes world 1 only', () => {
    const [a, b, d] = [runOf(1), runOf(2), runOf(3)];
    const through = c.score.lastIndex;
    const want = moneyRowsOf(a.feed, extrasOf(a.series), 100, through);
    const one = chunkOf([a.series, b.series], [b.series, d.series], a.feed, 100, through);
    expect(one.money).toEqual(want);
    expect(one.tiers).toEqual(extrasOf(a.series).tiers(100, through));
    // Other plan worlds and the twins do not move it.
    const two = chunkOf(
      [a.series, d.series, b.series],
      [a.series, a.series, a.series],
      a.feed,
      100,
      through
    );
    expect(two.money).toEqual(want);
    // A different world 1 gives different money.
    const other = chunkOf([b.series, a.series], [b.series, d.series], b.feed, 100, through);
    expect(other.money).toEqual(moneyRowsOf(b.feed, extrasOf(b.series), 100, through));
    expect(other.money).not.toEqual(want);
    expect(chunkOf([a.series], [b.series], null, 100, through).money).toBeNull();
  });

  it('a restored series gives the same money and keeps filing', () => {
    const r = runOf(2);
    const through = r.series.finalThrough();
    const back = createWorldSeries(c.score, structuredClone(r.series.data()));
    expect(extrasOf(back).homes(0, through)).toEqual(extrasOf(r.series).homes(0, through));
    expect(chunkOf([back], [back], r.feed, 0, through).money).toEqual(
      chunkOf([r.series], [r.series], r.feed, 0, through).money
    );
    // Saved mid-run, restored, then fed the rest: the same as the series never saved. The events
    // are replayed month by month against the final world (the unfunded feeds' 'after' order).
    const mid = 200;
    const events: { e: WorldEvent; month: number }[] = [];
    const whole = createWorldSeries(c.score);
    const got = feedFunded(c.statics, c.timeline, 2, c.months, whole, (e, _w, month) =>
      events.push({ e, month })
    );
    const first = createWorldSeries(c.score);
    let into = first;
    let at = 0;
    for (let month = 0; month <= c.months; month++) {
      for (; at < events.length && events[at].month === month; at++) {
        into.add(events[at].e, got.world, c.statics);
      }
      if (month > 0) into.stepped(month);
      if (month === mid) into = createWorldSeries(c.score, structuredClone(first.data()));
    }
    expect(into).not.toBe(first);
    expect(extrasOf(into).homes(0, through)).toEqual(extrasOf(whole).homes(0, through));
    expect(extrasOf(whole).homes(0, through)).toEqual(extrasOf(r.series).homes(0, through));
  });

  it('a displaced event counts in its own month whether or not the funded project has completed', () => {
    let later = 0;
    let never = 0;
    for (const seed of [1, 2, 3]) {
      const r = runOf(seed);
      const through = r.series.finalThrough();
      const horizon = lastDay(c.input.asOf, through);
      const monthOf = monthOfDayIn(c, through);
      const homes = extrasOf(r.series).homes(0, through);
      const step = (i: number) => homes[i].displaced - (i > 0 ? homes[i - 1].displaced : 0);
      /** The units of the events in calendar month i. */
      const inMonth = (i: number) =>
        r.displaced
          .filter((x) => x.day <= horizon && monthOf(x.day) === i)
          .reduce((a, x) => a + x.units, 0);
      for (const e of r.displaced) {
        if (e.day > horizon) continue;
        expect(r.world.projects.funded[e.row]).toBe(1);
        const i = monthOf(e.day);
        const done = r.completed.get(e.row);
        const doneMonth = done === undefined || done > horizon ? null : monthOf(done);
        if (doneMonth === i) continue;
        // Its own month steps up by its units (with any other event of that month) ...
        expect(e.units).toBeGreaterThan(0);
        expect(step(i)).toBe(inMonth(i));
        // ... and its row's completion month holds only that month's own events.
        if (doneMonth === null) never++;
        else {
          expect(step(doneMonth)).toBe(inMonth(doneMonth));
          if (doneMonth > i) later++;
        }
      }
    }
    // Both cases occur: a row completing in a later month, and one not completed by the horizon.
    expect(later).toBeGreaterThan(0);
    expect(never).toBeGreaterThan(0);
  });
});

describe('world 1 money, funded bench', () => {
  let c: City;
  let r: Run;
  // A bench city's funded world takes seconds.
  beforeAll(() => {
    c = cityOf(benchFunded('baseline').input, 240);
    r = run(c, 1);
  }, 120_000);

  it('pool series equal poolSeries of the same ledger', () => {
    expect(r.series.finalThrough()).toBe(c.score.lastIndex);
    checkPools(c, r);
  });

  it("fundedHomes equals moneyOf's at every month", () => {
    expect(checkHomes(c, r)).toBeGreaterThan(0);
  });
});

describe("rule 12 against today's engine, funded mini", () => {
  it("seeds 1-50: perAddedHome and displacedShare at the horizon are today's where the money is", () => {
    const c = cityOf(fundedMini(), 480);
    const last = c.score.lastIndex;
    const horizon = lastDay(c.input.asOf, last);
    const months = monthsOf(c.input.asOf, horizon);
    const same: number[] = [];
    const nonNull: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const r = run(c, seed);
      const money = viewOf([chunkOf([r.series], [r.series], r.feed, 0, last)], c.score).money!;
      const old = simulateDetailed(c.input, seed, horizon);
      const want = moneyOf({
        ledger: old.ledger,
        schedules: old.schedules,
        finance: c.fin,
        baseline: [],
        asOf: c.input.asOf,
        horizon,
        months
      });
      // Compared only where the world's money is the old engine's (funded homes and money spent).
      if (
        money.fundedHomes[last] !== want.fundedHomes[last] ||
        money.publicSpent[last] !== want.publicSpent[last]
      )
        continue;
      same.push(seed);
      expect(money.displacedHomesCompleted[last]).toBe(want.displacedHomes[last]);
      expect(money.perAddedHome).toEqual({
        all: perAddedHome(want, last, 'all'),
        city: perAddedHome(want, last, 'city')
      });
      expect(money.displacedShare).toBe(displacedShare(want, last));
      if (money.perAddedHome.all !== null) nonNull.push(seed);
    }
    // 49 of 50 on 2026-11-13 (seed 46's world differs: world-funding's tolerance).
    expect(same.length).toBeGreaterThanOrEqual(49);
    // Seeds 4 and 21 gave null under the mixed-timing denominator.
    expect(nonNull).toEqual(expect.arrayContaining([4, 21]));
  }, 120_000);
});
