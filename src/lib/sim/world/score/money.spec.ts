// Rules 2 and 9 on funded worlds: the plan world's pool series are `poolSeries` of its ledger by
// calendar month, `fundedHomes` is `moneyOf`'s, `displacedHomes` counts each 'displaced' event in
// its own month (today counts them when the funded project completes), and money in a chunk is
// the plan world's alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { displacedShare, moneyOf, perAddedHome, poolSeries } from '$lib/sim/scenario/finance-score';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { monthIndexer, monthsOf } from '$lib/sim/scenario/score';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { benchFunded } from '../funding/test/cities.node';
import { createFundingSystem } from '../funding';
import { fundOf, waitingAt } from '../funding/columns';
import {
  CLOSE_POOL,
  closingPolicy,
  fundedMini,
  moneyTimeline,
  oneMoneyTimeline
} from '../funding/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { miniDoc, span } from '../policy/test/fixtures';
import { monthFirstDay, monthOfDay } from '../months';
import { staticsOf, type Statics } from '../statics';
import { readAll } from '../test/run';
import { NO_DAY, type FundingSystem, type World, type WorldEvent } from '../types';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { chunkOf } from './chunk';
import { moneyRowsOf } from './money';
import { createWorldSeries, extrasOf } from './series';
import { finalTable } from './statics';
import { feedFunded, timelineStatics } from './test/feed';
import { chunksBefore, viewOf } from './view';
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

function cityOf(input: SimInput, months: number, doc?: SimPolicy4): City {
  const fin = input.finance!;
  const timeline = doc ? moneyTimeline(input, doc) : oneMoneyTimeline(input, fin);
  return {
    input,
    fin,
    statics: staticsOf(input),
    timeline,
    score: timelineStatics(input, timeline, months),
    months
  };
}

/** `system` is the funding system (default `createFundingSystem()`, closing spent pools). */
function run(
  c: City,
  seed: number,
  onEvent?: (e: WorldEvent, w: World) => void,
  system?: FundingSystem
): Run {
  const series = createWorldSeries(c.score);
  const displaced: Displaced[] = [];
  const completed = new Map<number, Day>();
  const got = feedFunded(
    c.statics,
    c.timeline,
    seed,
    c.months,
    series,
    (e, w) => {
      if (e.kind === 'displaced') displaced.push(e);
      else if (e.kind === 'end' && e.how === 'complete') completed.set(e.row, e.day);
      onEvent?.(e, w);
    },
    'live',
    system
  );
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

/**
 * Pool `id`'s `closed` and `shut` at the end of calendar month `i`, read off the world's shut rows:
 * `closed` is the first shut row's `shutFrom` once its spent day (`shutFrom - 1`) is within month
 * `i`; `shut` holds when some such row is still unopened at the month's last day.
 */
function shutAt(w: World, asOf: Day, id: string, i: number): { closed: Day | null; shut: boolean } {
  const p = fundOf(w).pools;
  const last = lastDay(asOf, i);
  let closed: Day | null = null;
  let shut = false;
  for (let k = 0; k < p.shutN; k++) {
    if (p.id[p.shutRow[k]] !== id || p.shutFrom[k] - 1 > last) continue;
    closed ??= p.shutFrom[k];
    if (p.shutTo[k] === NO_DAY || p.shutTo[k] > last) shut = true;
  }
  return { closed, shut };
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
        lostCredit: q.lostCredit[i],
        ...shutAt(r.world, c.input.asOf, q.id, i)
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

/**
 * Rule 12's figures by month: at every month i of a full view, today's `perAddedHome` and
 * `displacedShare` at i over the view's money with the completed-paired displaced term; at
 * `filledThrough`, the scalars exactly; a partial view gives the prefix. Returns the number of
 * months with no added homes (null in the series).
 */
function checkByMonth(c: City, r: Run): number {
  const last = c.score.lastIndex;
  const chunks = [
    chunkOf(r.series, r.series, r.feed, 0, 99),
    chunkOf(r.series, r.series, r.feed, 100, last)
  ];
  const m = viewOf(chunks, c.score).money!;
  const paired = { ...m, displacedHomes: m.displacedHomesCompleted };
  expect(m.perAddedHomeByMonth.all).toHaveLength(last + 1);
  expect(m.perAddedHomeByMonth.city).toHaveLength(last + 1);
  expect(m.displacedShareByMonth).toHaveLength(last + 1);
  let empty = 0;
  for (let i = 0; i <= last; i++) {
    expect(m.perAddedHomeByMonth.all[i]).toBe(perAddedHome(paired, i, 'all'));
    expect(m.perAddedHomeByMonth.city[i]).toBe(perAddedHome(paired, i, 'city'));
    expect(m.displacedShareByMonth[i]).toBe(displacedShare(paired, i));
    if (m.fundedHomes[i] - m.displacedHomesCompleted[i] <= 0) {
      expect(m.perAddedHomeByMonth.all[i]).toBeNull();
      expect(m.perAddedHomeByMonth.city[i]).toBeNull();
      empty++;
    }
    if (m.fundedHomes[i] <= 0) expect(m.displacedShareByMonth[i]).toBeNull();
  }
  expect(m.perAddedHomeByMonth.all[last]).toBe(m.perAddedHome.all);
  expect(m.perAddedHomeByMonth.city[last]).toBe(m.perAddedHome.city);
  expect(m.displacedShareByMonth[last]).toBe(m.displacedShare);
  // Not degenerate: some months have a figure.
  expect(m.perAddedHomeByMonth.all.some((x) => x !== null)).toBe(true);
  expect(m.displacedShareByMonth.some((x) => x !== null)).toBe(true);
  // A partial view gives the prefix, its last entry its own scalar.
  for (const k of [1, 60, 150]) {
    const p = viewOf(chunksBefore(chunks, k), c.score).money!;
    expect(p.perAddedHomeByMonth).toEqual({
      all: m.perAddedHomeByMonth.all.slice(0, k),
      city: m.perAddedHomeByMonth.city.slice(0, k)
    });
    expect(p.displacedShareByMonth).toEqual(m.displacedShareByMonth.slice(0, k));
    expect(p.perAddedHomeByMonth.all[k - 1]).toBe(p.perAddedHome.all);
    expect(p.perAddedHomeByMonth.city[k - 1]).toBe(p.perAddedHome.city);
    expect(p.displacedShareByMonth[k - 1]).toBe(p.displacedShare);
  }
  return empty;
}

describe('plan world money, funded mini', () => {
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

  it.each([1, 2, 3])(
    "seed %i: perAddedHome and displacedShare by month are today's at each month",
    (seed) => {
      // Early months have no funded homes: a month with no added homes gives null.
      expect(checkByMonth(c, runOf(seed))).toBeGreaterThan(0);
    }
  );

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

  it("money in a chunk describes the plan world only, and the twin's does not move it", () => {
    const [a, b, d] = [runOf(1), runOf(2), runOf(3)];
    const through = c.score.lastIndex;
    const want = moneyRowsOf(a.feed, extrasOf(a.series), 100, through);
    const one = chunkOf(a.series, b.series, a.feed, 100, through);
    expect(one.money).toEqual(want);
    expect(one.tiers).toEqual(extrasOf(a.series).tiers(100, through));
    expect(chunkOf(a.series, d.series, a.feed, 100, through).money).toEqual(want);
    // A different plan world gives different money.
    const other = chunkOf(b.series, a.series, b.feed, 100, through);
    expect(other.money).toEqual(moneyRowsOf(b.feed, extrasOf(b.series), 100, through));
    expect(other.money).not.toEqual(want);
    expect(chunkOf(a.series, b.series, null, 100, through).money).toBeNull();
  });

  it('waiting: every entry equals waitingAt at finalTable', () => {
    const r = runOf(1);
    const through = r.series.finalThrough();
    const table = finalTable(c.score);
    const got = chunkOf(r.series, r.series, r.feed, 0, through).waiting!;
    expect(got).toHaveLength(through + 1);
    for (let k = 0; k <= through; k++) {
      expect(got[k]).toBe(waitingAt(r.feed.world, table[k]));
    }
    expect(got.some((w) => w > 0)).toBe(true);
    // This fixture's calendar months each end in their own model month, so no two entries share a
    // table value here (the table is 1, 2, 3, ...); the monotone count is what the table orders.
    for (let k = 1; k <= through; k++) expect(table[k]).toBeGreaterThanOrEqual(table[k - 1]);
  });

  it('waiting: two adjacent chunks equal one chunk over both', () => {
    const r = runOf(1);
    const through = r.series.finalThrough();
    const whole = chunkOf(r.series, r.series, r.feed, 0, through).waiting!;
    const a = chunkOf(r.series, r.series, r.feed, 0, 99).waiting!;
    const b = chunkOf(r.series, r.series, r.feed, 100, through).waiting!;
    expect([...a, ...b]).toEqual(whole);
  });

  it('waiting: the twin does not move it', () => {
    const [a, b, d] = [runOf(1), runOf(2), runOf(3)];
    const through = c.score.lastIndex;
    const one = chunkOf(a.series, b.series, a.feed, 100, through).waiting;
    expect(one).toEqual(chunkOf(a.series, d.series, a.feed, 100, through).waiting);
    expect(one).toEqual(extrasOf(a.series).waiting(a.feed.world, 100, through));
  });

  it('a restored series gives the same money and keeps filing', () => {
    const r = runOf(2);
    const through = r.series.finalThrough();
    const back = createWorldSeries(c.score, structuredClone(r.series.data()));
    expect(extrasOf(back).homes(0, through)).toEqual(extrasOf(r.series).homes(0, through));
    expect(chunkOf(back, back, r.feed, 0, through).money).toEqual(
      chunkOf(r.series, r.series, r.feed, 0, through).money
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

// Pool closing in the money rows (spec sec-design-money). Test values.

/** Enough for one affordable project on the mini city. */
const ONE_PROJECT = 3_000_000;
/** The second span's first month: after CLOSE_POOL's closing under one span. */
const S2 = 60;
/** The mini money's guarantee needs `guaranteeRateCut` once money levers are in force. */
const TERMS: Policy = {
  id: 'terms',
  label: 'terms',
  preset: null,
  on: true,
  where: { tag: 'terms' },
  spans: [span(fundedMini().asOf, 1, null, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } })]
};

describe('plan world money, a pool that closes and opens', () => {
  it('closed and shut by month on a world that closes and opens a pool', () => {
    const input = fundedMini();
    const once = (m: number, d: number) => ({ kind: 'once' as const, day: m, dollars: d });
    const doc = miniDoc(
      closingPolicy(input.asOf, [
        { from: 1, to: S2 - 1, inflows: [once(monthFirstDay(input.asOf, 2), ONE_PROJECT)] },
        { from: S2, to: null, inflows: [once(monthFirstDay(input.asOf, S2) + 3, ONE_PROJECT)] }
      ]),
      TERMS
    );
    const c = cityOf(input, 150, doc);
    const r = run(c, 1);
    const through = r.series.finalThrough();
    const rows = moneyRowsOf(r.feed, extrasOf(r.series), 0, through);
    const p = fundOf(r.world).pools;
    const mine: number[] = [];
    for (let k = 0; k < p.shutN; k++) if (p.id[p.shutRow[k]] === CLOSE_POOL) mine.push(k);
    // Not vacuous: CLOSE_POOL closes, opens again and closes again within the window.
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(p.shutTo[mine[0]]).not.toBe(NO_DAY);
    const idx = monthIndexer(
      monthsOf(input.asOf, lastDay(input.asOf, through)),
      lastDay(input.asOf, through)
    );
    const spent = idx(p.shutFrom[mine[0]] - 1);
    const open = idx(p.shutTo[mine[0]]);
    expect(open).toBeLessThanOrEqual(through);
    const shutSeen: boolean[] = [];
    rows.forEach((row, i) => {
      for (const e of row.pools) {
        expect([e.closed, e.shut]).toEqual(Object.values(shutAt(r.world, input.asOf, e.id, i)));
        if (e.id !== CLOSE_POOL) continue;
        expect(e.closed).toBe(i < spent ? null : p.shutFrom[mine[0]]);
        if (i < spent) expect(e.shut).toBe(false);
        else if (i < open) expect(e.shut).toBe(true);
        if (e.shut !== undefined) shutSeen.push(e.shut);
      }
    });
    // It reads shut, open, then shut again.
    expect(shutSeen.join()).toMatch(/true.*false.*true/);
  });

  it('a pool found spent in month m and opened in month m + 1: closed holds, rows stay final', () => {
    const input = fundedMini();
    const asOf = input.asOf;
    const once = (d: Day, dollars: number) => ({ kind: 'once' as const, day: d, dollars });
    const first = [once(monthFirstDay(asOf, 2), ONE_PROJECT)];
    const mineOf = (w: World): { from: Day; to: Day }[] => {
      const p = fundOf(w).pools;
      const out: { from: Day; to: Day }[] = [];
      for (let k = 0; k < p.shutN; k++)
        if (p.id[p.shutRow[k]] === CLOSE_POOL) out.push({ from: p.shutFrom[k], to: p.shutTo[k] });
      return out;
    };
    // The month m whose step finds CLOSE_POOL spent under one span.
    const one = miniDoc(closingPolicy(asOf, [{ from: 1, to: null, inflows: first }]), TERMS);
    const m = monthOfDay(asOf, mineOf(run(cityOf(input, 120, one), 1).world)[0].from - 1);
    const doc = miniDoc(
      closingPolicy(asOf, [
        { from: 1, to: m, inflows: first },
        { from: m + 1, to: null, inflows: [once(monthFirstDay(asOf, m + 1), ONE_PROJECT)] }
      ]),
      TERMS
    );
    const F = monthFirstDay(asOf, m + 1);
    const afterM = run(cityOf(input, m, doc), 1);
    const afterM1 = run(cityOf(input, m + 1, doc), 1);
    expect(mineOf(afterM.world)).toEqual([{ from: F, to: NO_DAY }]);
    expect(mineOf(afterM1.world)).toEqual([{ from: F, to: F }]);
    // The calendar month holding the last day of month m (the spent day F - 1), and whether it
    // ends on that day.
    const horizon = lastDay(asOf, 240);
    const spent = monthIndexer(monthsOf(asOf, horizon), horizon)(F - 1);
    const ends = lastDay(asOf, spent) === F - 1;
    // A money row made final after step m reads the same after step m + 1 (that calendar month's
    // among them when it ends on F - 1).
    const through = afterM.series.finalThrough();
    expect(through >= spent).toBe(ends);
    expect(afterM1.series.finalThrough()).toBeGreaterThanOrEqual(through);
    expect(moneyRowsOf(afterM1.feed, extrasOf(afterM1.series), 0, through)).toEqual(
      moneyRowsOf(afterM.feed, extrasOf(afterM.series), 0, through)
    );
    // The view: closed holds F; shut only in that calendar month, when it ends on F - 1.
    const c = cityOf(input, m + 4, doc);
    const r = run(c, 1);
    const last = r.series.finalThrough();
    expect(last).toBeGreaterThanOrEqual(spent);
    const money = viewOf([chunkOf(r.series, r.series, r.feed, 0, last)], c.score).money!;
    expect(money.closed[CLOSE_POOL]).toBe(F);
    // Up to a later closing of it, if any.
    const again = mineOf(r.world)[1]?.from ?? Infinity;
    for (let i = 0; i <= last && lastDay(asOf, i) < again - 1; i++)
      expect(money.shut[CLOSE_POOL][i]).toBe(i === spent && ends);
  });
});

describe('plan world money, funded bench', () => {
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

  it("perAddedHome and displacedShare by month are today's at each month", () => {
    expect(checkByMonth(c, r)).toBeGreaterThan(0);
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
      // Today's engine never closes a pool: compared like for like (spec sec-design-option).
      const r = run(c, seed, undefined, createFundingSystem({ poolClosing: false }));
      const money = viewOf([chunkOf(r.series, r.series, r.feed, 0, last)], c.score).money!;
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
