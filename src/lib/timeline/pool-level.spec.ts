// A pool's level (timeline-ui, "A pool's bar shows its level"; funding-measures, "A pool's lifetime
// level"): what is left of all the money the pool receives in the window, by month, from the ledger
// series the page receives; its path in a bar's box; the words in the bar's name; and the set the
// page builds once per view.
import { beforeAll, describe, expect, it } from 'vitest';
import { inflowArrivals } from '$lib/sim/world/rules/funding';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { yearsAfter } from '$lib/sim-page/funding-presets';
import { fundedMini, oneMoneyTimeline } from '$lib/sim/world/funding/test/fixtures';
import { chunkOf } from '$lib/sim/world/score/chunk';
import { createWorldSeries } from '$lib/sim/world/score/series';
import { feedFunded, timelineStatics } from '$lib/sim/world/score/test/feed';
import type { MoneyView, TimelineView } from '$lib/sim/world/score/types';
import { viewOf } from '$lib/sim/world/score/view';
import { staticsOf } from '$lib/sim/world/statics';
import { dayFromUtc } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';
import { isNoCeiling, LEGACY_UNCAPPED_DOLLARS } from '$lib/timelapse/model';
import type { Inflow, Pool, Programme } from '$lib/timelapse/types';
import type { Policy, SimPolicy4 } from './policy4';
import { levelLeft, levelPath, levelSet, lifetimes, poolLevel, type LevelPool } from './pool-level';

type Series = MoneyView['pools'][number];

/** One pool's series from per-month rows of [received, committed, spent, out, lostCredit]. */
function series(id: string, rows: [number, number, number, number, number][]): Series {
  const col = (k: number) => rows.map((r) => r[k]);
  return {
    id,
    label: id,
    kind: 'generalRevenue',
    received: col(0),
    committed: col(1),
    spent: col(2),
    out: col(3),
    repaid: rows.map(() => 0),
    lost: col(4),
    lostCredit: col(4)
  };
}

/** A money view of `pools`; `shut` by pool id when given, else none. */
function money(pools: Series[], shut?: MoneyView['shut']): MoneyView {
  const n = pools[0]?.received.length ?? 0;
  const zeros = Array.from({ length: n }, () => 0);
  return {
    pools,
    fundedHomes: zeros,
    displacedHomes: zeros,
    publicSpent: zeros,
    owed: [],
    limits: [],
    displacedHomesCompleted: zeros,
    perAddedHome: { all: null, city: null },
    displacedShare: null,
    perAddedHomeByMonth: { all: zeros.map(() => null), city: zeros.map(() => null) },
    displacedShareByMonth: zeros.map(() => null),
    closed: {},
    shut: {},
    ...(shut === undefined ? {} : { shut })
  } as MoneyView;
}

const capped = (id: string, lifetime: number | null, leverage = 1): LevelPool => ({
  id,
  leverage,
  lifetime
});
const list = (a: ArrayLike<number>) => Array.from(a);

/** Each level equal to its expected value to 12 places; NaN where NaN is expected. */
function expectLevels(got: ArrayLike<number>, want: number[]): void {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => {
    if (Number.isNaN(w)) expect(Number.isNaN(got[i]), `month ${i}`).toBe(true);
    else expect(got[i], `month ${i}`).toBeCloseTo(w, 12);
  });
}

// Months on calendar month starts from Nov 2026; the dataset date mid-November.
const MONTHS: Day[] = Array.from({ length: 6 }, (_, i) => dayFromUtc(2026, 11 + i, 1));
const ASOF = MONTHS[0] + 14;
/** The day after month i ends: where its step ends. */
const end = (i: number) => (i + 1 < MONTHS.length ? MONTHS[i + 1] : dayFromUtc(2027, 5, 1));
/** The window's last day. */
const WINDOW_END = monthLastDay(ASOF, WINDOW_MONTHS);

const pool = (id: string, over: Partial<Pool> = {}): Pool => ({
  id,
  kind: 'generalRevenue',
  label: id,
  inflows: [],
  debt: null,
  leverage: 1,
  ...over
});
const fund = (id: string, p: Pool | null, where = p?.id ?? 'city', from: Day = ASOF): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where: { tag: 'fund', pool: where },
  spans: [{ from, to: null, what: { tag: 'fund', pool: p, programmes: [] } }]
});
const doc = (...money: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning: [], permitting: [], money }
});
const once = (day: Day, dollars: number): Inflow => ({ kind: 'once', day, dollars });
const yearly = (from: Day, dollarsPerYear: number, to: Day | null = null): Inflow => ({
  kind: 'yearly',
  from,
  to,
  dollarsPerYear
});
/** How many times `f` pays from the dataset date to `to` (the window's last day by default). */
const count = (f: Inflow, to: Day = WINDOW_END, from: Day = ASOF) =>
  inflowArrivals(f, from, to).length;
const GENERAL_REVENUE = 36_700_000;

describe('lifetimes', () => {
  const F = monthFirstDay(ASOF, 9);

  it('a bond: its principal; general revenue: 30 payments; nothing after a span ends', () => {
    const gr = yearly(F, GENERAL_REVENUE, yearsAfter(F, 29));
    const open = yearly(F, 10_000_000);
    const spanEnd = monthLastDay(ASOF, 54);
    const short: Policy = {
      ...fund('short', pool('u-short', { inflows: [open] })),
      spans: [
        {
          from: ASOF,
          to: spanEnd,
          what: { tag: 'fund', pool: pool('u-short', { inflows: [open] }), programmes: [] }
        }
      ]
    };
    const d = doc(
      fund('bond', pool('u-bond', { kind: 'goBond', inflows: [once(F, 300_000_000)] })),
      fund('gr', pool('u-gr', { inflows: [gr] })),
      short
    );
    const life = lifetimes(d, [pool('city')], ASOF);
    expect(life.get('u-bond')).toBe(300_000_000);
    expect(count(gr)).toBe(30);
    expect(life.get('u-gr')).toBe(30 * GENERAL_REVENUE);
    // Four payments fall in the span (months 9 to 54); the rest after it count nothing.
    expect(count(open, spanEnd)).toBe(4);
    expect(life.get('u-short')).toBe(4 * 10_000_000);
    // Every pool the track orders starts at 0: a baseline pool with no inflows.
    expect(life.get('city')).toBe(0);
    expect([...life.keys()]).toEqual(['city', 'u-bond', 'u-gr', 'u-short']);
  });

  it('an off policy: 0', () => {
    const off: Policy = {
      ...fund('off', pool('u-off', { inflows: [once(F, 5_000_000)] })),
      on: false
    };
    const life = lifetimes(doc(off), [], ASOF);
    expect(life.has('u-off')).toBe(true);
    expect(life.get('u-off')).toBe(0);
  });

  it("a yearly inflow with no end: its payments to the window's last month", () => {
    const x = yearly(ASOF + 1, 100_000_000);
    const life = lifetimes(doc(), [pool('city', { inflows: [x] })], ASOF);
    const n = count(x);
    expect(n).toBeGreaterThanOrEqual(39);
    expect(n).toBeLessThanOrEqual(40);
    expect(life.get('city')).toBe(n * 100_000_000);
  });

  it('a no-ceiling pool: null', () => {
    expect(isNoCeiling(LEGACY_UNCAPPED_DOLLARS)).toBe(true);
    const legacy = pool('legacy-fed', {
      kind: 'federal',
      inflows: [yearly(ASOF + 1, LEGACY_UNCAPPED_DOLLARS)]
    });
    const own = pool('u-legacy', {
      kind: 'federal',
      inflows: [yearly(F, LEGACY_UNCAPPED_DOLLARS)]
    });
    const city = pool('city', { inflows: [yearly(ASOF + 1, 100)] });
    const life = lifetimes(doc(fund('legacy-own', own)), [city, legacy], ASOF);
    expect(life.get('legacy-fed')).toBeNull();
    expect(life.get('u-legacy')).toBeNull();
    expect(life.get('city')).toBe(count(yearly(ASOF + 1, 100)) * 100);
  });

  it("state-double: twice the state's ten years of arrivals", () => {
    const x = yearly(ASOF + 1, 50_000_000);
    const D = monthFirstDay(ASOF, 21);
    const D10 = yearsAfter(D, 10);
    const double: Policy = {
      id: 'state-double',
      label: 'State money doubled',
      preset: null,
      on: true,
      where: { tag: 'baseline' },
      spans: [
        {
          from: D,
          to: null,
          what: {
            tag: 'scales',
            entries: [
              { pool: 'state', from: D, scale: 2 },
              { pool: 'state', from: D10, scale: 1 }
            ]
          }
        }
      ]
    };
    const base = [pool('state', { kind: 'state', inflows: [x] })];
    const plain = lifetimes(doc(), base, ASOF).get('state')!;
    const doubled = lifetimes(doc(double), base, ASOF).get('state')!;
    const ten = count(x, D10 - 1, D);
    expect(ten).toBe(10);
    expect(plain).toBe(count(x) * 50_000_000);
    expect(doubled).toBe(plain + ten * 50_000_000);
  });

  it('null for every pool when the track throws', () => {
    // A guarantee needs guaranteeRateCut, which has no source: building the money throws.
    const g: Programme = {
      id: 'u-g-p',
      label: 'guarantee',
      pool: 'u-g',
      reach: 'affordable',
      instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 },
      from: ASOF,
      to: null,
      minHomes: 0,
      tiers: null
    };
    const p: Policy = {
      ...fund('g', null),
      where: { tag: 'fund', pool: 'u-g' },
      spans: [
        {
          from: ASOF,
          to: null,
          what: {
            tag: 'fund',
            pool: pool('u-g', { inflows: [once(F, 1_000_000)] }),
            programmes: [g]
          }
        }
      ]
    };
    const city = pool('city', { inflows: [yearly(ASOF + 1, 100)] });
    const life = lifetimes(doc(p), [city], ASOF);
    expect([...life.keys()]).toEqual(['city', 'u-g']);
    expect([...life.values()]).toEqual([null, null]);
  });

  it('Review Focus 5: a measure started in month 470 counts only arrivals in the window', () => {
    const F470 = monthFirstDay(ASOF, 470);
    const gr = yearly(F470, GENERAL_REVENUE, yearsAfter(F470, 29));
    const life = lifetimes(
      doc(fund('late', pool('u-late', { inflows: [gr] }), 'u-late', F470)),
      [],
      ASOF
    );
    // Thirty payments, but the window ends ten months after the first.
    expect(count(gr, WINDOW_END)).toBe(1);
    expect(life.get('u-late')).toBe(GENERAL_REVENUE * count(gr, WINDOW_END));
  });
});

describe('poolLevel with lifetimes', () => {
  it('1 before the first payment; drains as money is committed; no rise at a yearly payment; rises when a loan is repaid', () => {
    const city = series('city', [
      [0, 0, 0, 0, 0],
      [20, 0, 0, 0, 0],
      [20, 15, 0, 0, 0],
      // The next year's payment arrives: the level does not rise.
      [40, 10, 10, 0, 0],
      // A loan goes out.
      [40, 0, 0, 30, 0],
      // Part of it is repaid.
      [40, 0, 0, 10, 0]
    ]);
    const l = poolLevel(money([city]), [capped('city', 100)]);
    expect(l).toBeInstanceOf(Float64Array);
    expectLevels(l, [1, 1, 0.85, 0.8, 0.7, 0.9]);
    expect(l[3]).toBeLessThanOrEqual(l[2]);
    expect(l[5]).toBeGreaterThan(l[4]);
  });

  it('a pool with no end drains and never refills', () => {
    // Forty payments of 10 in the window; one every three months here, 5 committed a month.
    const rows: [number, number, number, number, number][] = Array.from({ length: 12 }, (_, i) => [
      10 * (Math.floor(i / 3) + 1),
      5 * i,
      0,
      0,
      0
    ]);
    const l = poolLevel(money([series('city', rows)]), [capped('city', 400)]);
    expectLevels(
      l,
      rows.map((r) => (400 - r[1]) / 400)
    );
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThanOrEqual(l[i - 1]);
    expect(l[l.length - 1]).toBeLessThan(1);
  });

  it('a month shut marks reads 0, also after money returns; the reopening month reads by the formula', () => {
    const bond = series('bond', [
      [100, 0, 0, 0, 0],
      [100, 60, 40, 0, 0],
      // A commitment of 10 is released: money returns to a closed pool.
      [100, 50, 40, 0, 0],
      [100, 50, 40, 0, 0]
    ]);
    const m = money([bond], { bond: [false, true, true, false] });
    expectLevels(poolLevel(m, [capped('bond', 100)]), [1, 0, 0, 0.1]);
  });

  it('one shut month between open months reads 0 alone', () => {
    const p = series('p', [
      [100, 0, 0, 0, 0],
      [100, 20, 0, 0, 0],
      [100, 20, 0, 0, 0]
    ]);
    expectLevels(
      poolLevel(money([p], { p: [false, true, false] }), [capped('p', 100)]),
      [1, 0, 0.8]
    );
    // A shut history shorter than the series reads open past its end.
    expectLevels(poolLevel(money([p], { p: [true] }), [capped('p', 100)]), [0, 0.8, 0.8]);
  });

  it('in a summed set a closed pool counts its whole lifetime as used', () => {
    const a = series('a', [[100, 0, 0, 0, 0]]);
    const b = series('b', [[300, 30, 0, 0, 0]]);
    const m = money([a, b], { a: [true] });
    expectLevels(poolLevel(m, [capped('a', 100), capped('b', 300)]), [(0 + 270) / 400]);
  });

  it('leverage scales the lifetime: a bank pool at leverage 3', () => {
    const bank = series('bank', [
      [100, 0, 0, 0, 0],
      [100, 150, 0, 0, 0],
      [100, 0, 0, 240, 0],
      [100, 0, 0, 290, 10]
    ]);
    expectLevels(poolLevel(money([bank]), [capped('bank', 100, 3)]), [1, 0.5, 0.2, 0]);
  });

  it('a lifetime of 0 gives NaN', () => {
    const p = series('p', [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ]);
    expect(list(poolLevel(money([p]), [capped('p', 0)])).every(Number.isNaN)).toBe(true);
  });

  it('a null lifetime is left out of both sums; NaN when every lifetime is null', () => {
    const a = series('a', [[0, 50, 0, 0, 0]]);
    const b = series('b', [[100, 25, 0, 0, 0]]);
    expectLevels(poolLevel(money([a, b]), [capped('a', null), capped('b', 100)]), [0.75]);
    expect(Number.isNaN(poolLevel(money([a, b]), [capped('a', null)])[0])).toBe(true);
  });

  it('NaN for a pool the money does not carry, and for no pool at all', () => {
    const fed = series('fed', [
      [0, 50, 0, 0, 0],
      [0, 80, 20, 0, 0]
    ]);
    expect(list(poolLevel(money([fed]), [capped('other', 100)])).every(Number.isNaN)).toBe(true);
    expect(list(poolLevel(money([fed]), [])).every(Number.isNaN)).toBe(true);
  });

  it('clamps to [0, 1]', () => {
    const odd = series('odd', [[100, 120, 0, 0, 0]]);
    expect(list(poolLevel(money([odd]), [capped('odd', 100)]))).toEqual([0]);
  });
});

describe('poolLevel on a real ledger (the funded mini city)', () => {
  // The engine's own series for the funded mini city: a yearly City pool with no end, a bank pool
  // at leverage 0.8 paid once, a federal pool with no ceiling (finance-engine.md, the mini fixture).
  let m: MoneyView;
  let defs: Pool[];
  let life: ReadonlyMap<string, number | null>;
  beforeAll(() => {
    const input = fundedMini();
    const fin = input.finance!;
    const timeline = oneMoneyTimeline(input, fin);
    const score = timelineStatics(input, timeline, 240);
    const s = createWorldSeries(score);
    const got = feedFunded(staticsOf(input), timeline, 1, 240, s);
    const feed = {
      ledger: got.ledger,
      finance: timeline.frameAt(1).finance!,
      world: got.world,
      statics: staticsOf(input)
    };
    m = viewOf([chunkOf(s, s, feed, 0, score.lastIndex)], score).money!;
    defs = fin.pools;
    life = lifetimes(doc(), defs, input.asOf);
  });

  it('within [0, 1] in every month; a yearly payment never raises it', () => {
    expect(life.get('federal')).toBeNull();
    let drained = 0;
    let payments = 0;
    for (const def of defs) {
      const L = life.get(def.id);
      const q = m.pools.find((p) => p.id === def.id)!;
      const l = poolLevel(m, [{ id: def.id, leverage: def.leverage, lifetime: L ?? null }]);
      if (L === null || L === undefined) {
        expect(list(l).every(Number.isNaN), def.id).toBe(true);
        continue;
      }
      const cap = def.leverage * L;
      expect(cap, def.id).toBeGreaterThan(0);
      const used = (i: number) => q.committed[i] + q.spent[i] + q.out[i] + q.lostCredit[i];
      for (let i = 0; i < l.length; i++) {
        // The lifetime holds every dollar the engine paid in.
        expect(def.leverage * q.received[i], `${def.id} month ${i}`).toBeLessThanOrEqual(cap);
        const raw = (cap - used(i)) / cap;
        expect(raw, `${def.id} month ${i}`).toBeGreaterThanOrEqual(-1e-12);
        expect(raw, `${def.id} month ${i}`).toBeLessThanOrEqual(1);
        const shut = m.shut[def.id]?.[i] === true;
        expect(l[i]).toBeCloseTo(shut ? 0 : Math.min(Math.max(raw, 0), 1), 12);
        if (l[i] < 1) drained++;
        if (i > 0 && q.received[i] > q.received[i - 1] && used(i) >= used(i - 1)) {
          payments++;
          if (!shut) expect(l[i], `${def.id} month ${i}`).toBeLessThanOrEqual(l[i - 1]);
        }
      }
    }
    // Not degenerate: money is committed and spent, and yearly payments arrive.
    expect(drained).toBeGreaterThan(0);
    expect(payments).toBeGreaterThan(0);
  });
});

describe('levelPath', () => {
  it('steps month by month: the level of month i holds across month i', () => {
    // A box exactly months 1 to 3, 1000 wide: each month a third, give or take a day.
    const from = MONTHS[1];
    const to = end(3);
    const x = (d: Day) => (((d - from) / (to - from)) * 1000).toFixed(2);
    const d = levelPath([1, 1, 0.5, 0.25, 0], MONTHS, ASOF, from, to);
    expect(d).toBe(
      `M${x(MONTHS[1])},0` +
        `L${x(MONTHS[1])},0.00L${x(end(1))},0.00` +
        `L${x(end(1))},10.00L${x(end(2))},10.00` +
        `L${x(end(2))},15.00L${x(end(3))},15.00` +
        `L${x(end(3))},0Z`
    );
  });

  it('levelPath never writes NaN and breaks the path across a NaN run; empty string with no level', () => {
    const from = ASOF;
    const to = end(5);
    const d = levelPath([NaN, 1, NaN, NaN, 0.5, 0.5], MONTHS, ASOF, from, to);
    expect(d).not.toMatch(/NaN/);
    // Two runs: month 1, then months 4 and 5.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(levelPath([NaN, NaN], MONTHS, ASOF, from, to)).toBe('');
    expect(levelPath([], MONTHS, ASOF, from, to)).toBe('');
  });

  it('clips each month to the box; months outside it write nothing', () => {
    // A box from mid month 1 to mid month 2.
    const from = MONTHS[1] + 10;
    const to = MONTHS[2] + 10;
    const d = levelPath([0.5, 0.5, 0.5, 0.5], MONTHS, ASOF, from, to);
    const xs = [...d.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(1000);
    // Month 0 starts at the dataset date, not at the month's first day.
    const zero = levelPath([1], MONTHS, ASOF, MONTHS[0], end(0));
    const x0 = (((ASOF - MONTHS[0]) / (end(0) - MONTHS[0])) * 1000).toFixed(2);
    expect(zero.startsWith(`M${x0},0`)).toBe(true);
  });
});

describe('levelLeft', () => {
  it('levelLeft: ", 62% left"; ", 0% left" for a dry pool; null where NaN', () => {
    const l = [NaN, 0.62, 0, 0.004, 1];
    expect(levelLeft(l, 1)).toBe(', 62% left');
    expect(levelLeft(l, 2)).toBe(', 0% left');
    expect(levelLeft(l, 3)).toBe(', 0% left');
    expect(levelLeft(l, 4)).toBe(', 100% left');
    expect(levelLeft(l, 0)).toBeNull();
    expect(levelLeft(l, -1)).toBeNull();
    expect(levelLeft(l, 5)).toBeNull();
  });
});

describe('levelSet with lifetimes', () => {
  const view = (m: MoneyView | null): TimelineView =>
    ({
      months: MONTHS,
      lastIndex: MONTHS.length - 1,
      filledThrough: 1,
      money: m
    }) as TimelineView;
  const m = money([
    series('city', [
      [100, 0, 0, 0, 0],
      [100, 50, 0, 0, 0]
    ]),
    series('state', [
      [300, 0, 0, 0, 0],
      [300, 0, 0, 0, 0]
    ]),
    series('fed', [
      [100, 0, 0, 0, 0],
      [100, 40, 0, 0, 0]
    ]),
    series('legacy-fed', [
      [0, 0, 0, 0, 0],
      [0, 30, 10, 0, 0]
    ]),
    series('u-bond', [
      [0, 0, 0, 0, 0],
      [200, 50, 0, 0, 0]
    ]),
    series('u-bank', [
      [100, 0, 0, 0, 0],
      [100, 100, 0, 0, 0]
    ])
  ]);
  /** Today's sources: yearly from the day after the dataset date, with no end. */
  const today = (dollars: number): Inflow[] => [yearly(ASOF + 1, dollars)];
  const N = count(yearly(ASOF + 1, 1));
  const fed = pool('fed', { kind: 'federal', inflows: today(100) });
  const baseline = [
    pool('city', { inflows: today(100) }),
    pool('state', { kind: 'state', inflows: today(300) }),
    fed
  ];
  const bond = (dollars: number) =>
    fund('bond', pool('u-bond', { kind: 'goBond', inflows: [once(ASOF + 40, dollars)] }));

  it('entries use lifetimes; Current funding reads baseline pools with no end and leaves out a no-ceiling pool', () => {
    const legacy = pool('legacy-fed', {
      kind: 'federal',
      inflows: today(LEGACY_UNCAPPED_DOLLARS)
    });
    const d = doc(
      bond(200),
      fund('rides', null, 'city'),
      fund('bank', pool('u-bank', { kind: 'bank', leverage: 2, inflows: [once(ASOF + 40, 100)] })),
      fund('legacy-own', { ...legacy, id: 'u-legacy' })
    );
    const s = levelSet(view(m), d, [...baseline, legacy], ASOF)!;
    expect(s.months).toBe(MONTHS);
    expect(s.asOf).toBe(ASOF);
    expect([...s.byPolicy.keys()]).toEqual(['bond', 'bank']);
    // A bond of 200, 50 committed.
    expectLevels(s.byPolicy.get('bond')!, [1, 0.75]);
    // Leverage from the document's pool: 2 x 100 over its lifetime, 100 committed.
    expectLevels(s.byPolicy.get('bank')!, [1, 0.5]);
    // City, state and federal over every payment in the window: 500 N, 90 used.
    expectLevels(s.fixed!, [1, (500 * N - 90) / (500 * N)]);
    // The federal pool alone, and as a fund policy's own pool.
    expectLevels(levelSet(view(m), doc(), [fed], ASOF)!.fixed!, [1, 1 - 40 / (100 * N)]);
    expectLevels(levelSet(view(m), doc(fund('fed-own', fed)), [], ASOF)!.byPolicy.get('fed-own')!, [
      1,
      1 - 40 / (100 * N)
    ]);
    // A no-ceiling pool alone: nothing is summed.
    expect(levelSet(view(m), doc(), [legacy], ASOF)!.fixed).toBeNull();
  });

  it("a pool's leverage is its definition in the window's last month, as the score's", () => {
    const early = pool('u-bank', { kind: 'bank', leverage: 2, inflows: [once(ASOF + 10, 100)] });
    const late = pool('u-bank', { kind: 'bank', leverage: 4, inflows: [once(ASOF + 10, 100)] });
    const p: Policy = {
      ...fund('bank', early),
      spans: [
        { from: ASOF, to: ASOF + 59, what: { tag: 'fund', pool: early, programmes: [] } },
        { from: ASOF + 60, to: null, what: { tag: 'fund', pool: late, programmes: [] } }
      ]
    };
    expect(monthFirstDay(ASOF, WINDOW_MONTHS)).toBeGreaterThan(ASOF + 60);
    const s = levelSet(view(m), doc(p), baseline, ASOF)!;
    // 4 x 100, 100 committed.
    expectLevels(s.byPolicy.get('bank')!, [1, 0.75]);
  });

  it('a document whose money track throws has no levels', () => {
    const g: Programme = {
      id: 'u-g-p',
      label: 'guarantee',
      pool: 'u-bond',
      reach: 'affordable',
      instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 },
      from: ASOF,
      to: null,
      minHomes: 0,
      tiers: null
    };
    const p = bond(200);
    const s0 = p.spans[0];
    if (s0.what.tag === 'fund') s0.what.programmes = [g];
    const s = levelSet(view(m), doc(p), baseline, ASOF)!;
    expect(s.byPolicy.size).toBe(0);
    expect(s.fixed).toBeNull();
  });

  it('a second view with the same document reuses the lifetimes; a new document recomputes', () => {
    const d = doc(bond(200));
    expect(lifetimes(d, baseline, ASOF)).toBe(lifetimes(d, baseline, ASOF));
    // A bigger bond in a new document: its lifetime and its level change.
    const d2 = structuredClone(d);
    const w = d2.kinds.money[0].spans[0].what;
    if (w.tag === 'fund' && w.pool !== null) w.pool.inflows = [once(ASOF + 40, 400)];
    expect(lifetimes(d, baseline, ASOF).get('u-bond')).toBe(200);
    expect(lifetimes(d2, baseline, ASOF).get('u-bond')).toBe(400);
    expectLevels(levelSet(view(m), d, baseline, ASOF)!.byPolicy.get('bond')!, [1, 0.75]);
    expectLevels(levelSet(view(m), d2, baseline, ASOF)!.byPolicy.get('bond')!, [1, 0.875]);
    // And back to the first document: not the second's stale values.
    expect(lifetimes(d, baseline, ASOF).get('u-bond')).toBe(200);
    // A new baseline array or another dataset date recomputes too.
    expect(lifetimes(d, [...baseline], ASOF).get('city')).toBe(100 * N);
    expect(lifetimes(d, baseline, ASOF + 1).get('city')).toBe(
      100 * count(yearly(ASOF + 1, 1), monthLastDay(ASOF + 1, WINDOW_MONTHS), ASOF + 1)
    );
  });

  it('null without a view or without money; no fixed without baseline pools', () => {
    expect(levelSet(null, doc(), baseline, ASOF)).toBeNull();
    expect(levelSet(view(null), doc(), baseline, ASOF)).toBeNull();
    expect(levelSet(view(m), doc(), undefined, ASOF)!.fixed).toBeNull();
  });
});
