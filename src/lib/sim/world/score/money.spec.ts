// Rules 2 and 9 on funded worlds: world 1's pool series are `poolSeries` of its ledger by
// calendar month, `fundedHomes` is `moneyOf`'s, and money in a chunk is world 1's alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { moneyOf, poolSeries } from '$lib/sim/scenario/finance-score';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { monthsOf } from '$lib/sim/scenario/score';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { benchFunded, fundedMini, oneMoneyTimeline } from '../funding/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { benchInput } from '../test/cities.node';
import { readAll } from '../test/run';
import type { World, WorldEvent } from '../types';
import { chunkOf } from './chunk';
import { moneyRowsOf } from './money';
import { createWorldSeries, extrasOf } from './series';
import { feedFunded, timelineStatics } from './test/feed';
import type { MoneyFeed, ScoreStatics, WorldSeries } from './types';

type Finance = NonNullable<SimInput['finance']>;

/** The last day of calendar month `i` from the dataset month. */
const lastDay = (asOf: Day, i: number): Day => addMonths(firstOfMonth(asOf), i + 1) - 1;

interface Run {
  series: WorldSeries;
  world: World;
  ledger: LedgerEvent[];
  feed: MoneyFeed;
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
  const got = feedFunded(c.statics, c.timeline, seed, c.months, series, onEvent);
  const feed: MoneyFeed = {
    ledger: got.ledger,
    finance: c.timeline.frameAt(1).finance!,
    world: got.world,
    statics: c.statics
  };
  return { series, ...got, feed };
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
  // No 'displaced' event is sent yet (world-funding's shadows): both sides are 0 every month.
  expect(got.map((m) => m.displacedHomes)).toEqual(want.displacedHomes);
  return want.fundedHomes[through];
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

  it.todo(
    // Waits for world-funding shadows sha: no 'displaced' event is sent yet, and the test is not
    // to hand-build one. Then: find a 'displaced' event whose row completes in a later calendar
    // month or not by the horizon; displacedHomes steps up by e.units at monthOf(e.day) only.
    'a displaced event counts in its own month whether or not the funded project has completed'
  );
});

describe('world 1 money, funded bench', () => {
  let c: City;
  let r: Run;
  // A bench city's funded world takes seconds.
  beforeAll(() => {
    c = cityOf(benchFunded(benchInput()), 240);
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
