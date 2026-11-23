// A pool's level (timeline-ui, "A pool's bar shows its level"): the free share of the money it has
// received so far, by month, from the ledger series the page receives; its path in a bar's box;
// the words in the bar's name; and the set the page builds once per view.
import { beforeAll, describe, expect, it } from 'vitest';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
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
import type { Pool } from '$lib/timelapse/types';
import type { Policy, SimPolicy4 } from './policy4';
import { levelLeft, levelPath, levelSet, poolLevel, type LevelPool } from './pool-level';

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

function money(pools: Series[]): MoneyView {
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
    displacedShareByMonth: zeros.map(() => null)
  } as MoneyView;
}

const capped = (id: string, leverage = 1): LevelPool => ({ id, leverage });
const list = (a: ArrayLike<number>) => Array.from(a);

describe('poolLevel', () => {
  it('poolLevel: NaN before the first arrival; 1 at arrival with nothing committed', () => {
    const m = money([
      series('bond', [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [100, 0, 0, 0, 0]
      ])
    ]);
    const l = poolLevel(m, [capped('bond')]);
    expect(l).toBeInstanceOf(Float64Array);
    expect(l).toHaveLength(3);
    expect(Number.isNaN(l[0])).toBe(true);
    expect(Number.isNaN(l[1])).toBe(true);
    expect(l[2]).toBe(1);
  });

  it('a once pool drains as it commits and spends; a yearly pool tops up at each arrival', () => {
    const once = series('bond', [
      [100, 0, 0, 0, 0],
      [100, 30, 0, 0, 0],
      [100, 20, 30, 0, 0],
      [100, 0, 70, 20, 10]
    ]);
    expect(list(poolLevel(money([once]), [capped('bond')]))).toEqual([1, 0.7, 0.5, 0]);
    const yearly = series('city', [
      [20, 0, 0, 0, 0],
      [20, 15, 0, 0, 0],
      [20, 5, 15, 0, 0],
      // The next year's money arrives: what is free is now 20 of 40.
      [40, 5, 15, 0, 0],
      [40, 10, 25, 0, 0]
    ]);
    const l = list(poolLevel(money([yearly]), [capped('city')]));
    expect(l).toEqual([1, 0.25, 0, 0.5, 0.125]);
    // It refills at the arrival: the level rises.
    expect(l[3]).toBeGreaterThan(l[2]);
  });

  it('leverage scales what is free: a bank pool at leverage 3', () => {
    const bank = series('bank', [
      [100, 0, 0, 0, 0],
      [100, 150, 0, 0, 0],
      [100, 0, 0, 240, 0],
      [100, 0, 0, 290, 10]
    ]);
    const l = list(poolLevel(money([bank]), [capped('bank', 3)]));
    expect(l).toEqual([1, 0.5, 0.2, 0]);
  });

  it('several pools: the free share of all their money together', () => {
    const a = series('a', [[100, 50, 0, 0, 0]]);
    const b = series('b', [[300, 0, 0, 0, 0]]);
    expect(list(poolLevel(money([a, b]), [capped('a'), capped('b')]))).toEqual([350 / 400]);
  });

  it('NaN for a pool the money does not carry, and for no pool at all', () => {
    const fed = series('fed', [
      [0, 50, 0, 0, 0],
      [0, 80, 20, 0, 0]
    ]);
    expect(list(poolLevel(money([fed]), [capped('other')])).every(Number.isNaN)).toBe(true);
    expect(list(poolLevel(money([fed]), [])).every(Number.isNaN)).toBe(true);
  });

  it('clamps to [0, 1]', () => {
    const odd = series('odd', [[100, 120, 0, 0, 0]]);
    expect(list(poolLevel(money([odd]), [capped('odd')]))).toEqual([0]);
  });
});

describe('poolLevel on a real ledger (the funded mini city)', () => {
  // The engine's own series for the funded mini city: a yearly City pool, a bank pool at leverage
  // 0.8 paid once, a federal pool (finance-engine.md, the mini fixture).
  let m: MoneyView;
  let defs: Pool[];
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
  });

  it('within [0, 1] by identity I4 in every month with money: the clamp does no work', () => {
    let drained = 0;
    let refilled = 0;
    for (const def of defs) {
      const q = m.pools.find((p) => p.id === def.id)!;
      const l = poolLevel(m, [{ id: def.id, leverage: def.leverage }]);
      for (let i = 0; i < l.length; i++) {
        const cap = def.leverage * q.received[i];
        if (cap === 0) {
          expect(Number.isNaN(l[i]), `${def.id} ${i}`).toBe(true);
          continue;
        }
        // The level unclamped, from the series as finance-score.md defines them.
        const raw = (cap - q.committed[i] - q.spent[i] - q.out[i] - q.lostCredit[i]) / cap;
        expect(raw, `${def.id} month ${i}`).toBeGreaterThanOrEqual(-1e-12);
        expect(raw, `${def.id} month ${i}`).toBeLessThanOrEqual(1);
        expect(l[i]).toBeCloseTo(Math.min(Math.max(raw, 0), 1), 12);
        if (l[i] < 1) drained++;
        if (i > 0 && l[i] > l[i - 1] && q.received[i] > q.received[i - 1]) refilled++;
      }
    }
    // Not degenerate: money is committed and spent, and the yearly pool refills.
    expect(drained).toBeGreaterThan(0);
    expect(refilled).toBeGreaterThan(0);
  });
});

// Months on calendar month starts from Nov 2026; the dataset date mid-November.
const MONTHS: Day[] = Array.from({ length: 6 }, (_, i) => dayFromUtc(2026, 11 + i, 1));
const ASOF = MONTHS[0] + 14;
/** The day after month i ends: where its step ends. */
const end = (i: number) => (i + 1 < MONTHS.length ? MONTHS[i + 1] : dayFromUtc(2027, 5, 1));

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

describe('levelSet', () => {
  const pool = (id: string, over: Partial<Pool> = {}): Pool => ({
    id,
    kind: 'generalRevenue',
    label: id,
    inflows: [],
    debt: null,
    leverage: 1,
    ...over
  });
  const fund = (id: string, p: Pool | null, where = p?.id ?? 'city'): Policy => ({
    id,
    label: id,
    preset: null,
    on: true,
    where: { tag: 'fund', pool: where },
    spans: [{ from: ASOF, to: null, what: { tag: 'fund', pool: p, programmes: [] } }]
  });
  const doc = (...money: Policy[]): SimPolicy4 => ({
    schema: 4,
    kinds: { zoning: [], permitting: [], money }
  });
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
    series('u-free', [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ]),
    series('u-bank', [
      [100, 0, 0, 0, 0],
      [100, 100, 0, 0, 0]
    ])
  ]);
  /** A yearly inflow from the dataset date with no end. */
  const yearly = (dollarsPerYear: number): Pool['inflows'] => [
    { kind: 'yearly', from: ASOF, to: null, dollarsPerYear }
  ];
  const fed = pool('fed', { kind: 'federal', inflows: yearly(20_000_000) });
  const baseline = [pool('city'), pool('state'), fed];

  it('levelSet: one entry per fund policy with an own pool the money carries', () => {
    const d = doc(
      fund('bond', pool('u-bond')),
      fund('rides', null, 'city'),
      fund('bank', pool('u-bank', { kind: 'bank', leverage: 2 }))
    );
    const s = levelSet(view(m), d, baseline, ASOF)!;
    expect(s.months).toBe(MONTHS);
    expect(s.asOf).toBe(ASOF);
    expect([...s.byPolicy.keys()]).toEqual(['bond', 'bank']);
    expect(list(s.byPolicy.get('bond')!)).toEqual([NaN, 0.75]);
    // Leverage from the document's pool: 2 x 100 received, 100 committed.
    expect(list(s.byPolicy.get('bank')!)).toEqual([1, 0.5]);
  });

  it('gives the federal pool a level', () => {
    // Alone in the baseline: 100 received, 40 committed.
    expect(list(levelSet(view(m), doc(), [fed], ASOF)!.fixed!)).toEqual([1, 0.6]);
    // As a fund policy's own pool.
    const s = levelSet(view(m), doc(fund('fed-own', fed)), [], ASOF)!;
    expect(list(s.byPolicy.get('fed-own')!)).toEqual([1, 0.6]);
  });

  it('sums every baseline pool into Current funding', () => {
    const s = levelSet(view(m), doc(), baseline, ASOF)!;
    // City, state and federal: (500 - 50 - 40) / 500.
    expect(list(s.fixed!)).toEqual([1, 410 / 500]);
  });

  it('gives a pool with a ten trillion yearly inflow no level and leaves it out of the sum', () => {
    const legacy = pool('legacy-fed', {
      kind: 'federal',
      inflows: yearly(LEGACY_UNCAPPED_DOLLARS)
    });
    expect(isNoCeiling(LEGACY_UNCAPPED_DOLLARS)).toBe(true);
    const s = levelSet(view(m), doc(fund('legacy-own', legacy)), [...baseline, legacy], ASOF)!;
    expect(s.byPolicy.has('legacy-own')).toBe(false);
    // The same sum as without it: (500 - 50 - 40) / 500.
    expect(list(s.fixed!)).toEqual([1, 410 / 500]);
    // Alone, nothing is summed.
    expect(levelSet(view(m), doc(), [legacy], ASOF)!.fixed).toBeNull();
  });

  it("a pool's leverage is its definition in the window's last month, as the score's", () => {
    const early = pool('u-bank', { kind: 'bank', leverage: 2 });
    const late = pool('u-bank', { kind: 'bank', leverage: 4 });
    const p: Policy = {
      ...fund('bank', early),
      spans: [
        { from: ASOF, to: ASOF + 59, what: { tag: 'fund', pool: early, programmes: [] } },
        { from: ASOF + 60, to: null, what: { tag: 'fund', pool: late, programmes: [] } }
      ]
    };
    expect(monthFirstDay(ASOF, WINDOW_MONTHS)).toBeGreaterThan(ASOF + 60);
    const s = levelSet(view(m), doc(p), baseline, ASOF)!;
    expect(list(s.byPolicy.get('bank')!)).toEqual([1, 0.75]);
  });

  it('null without a view or without money; no fixed without baseline pools', () => {
    expect(levelSet(null, doc(), baseline, ASOF)).toBeNull();
    expect(levelSet(view(null), doc(), baseline, ASOF)).toBeNull();
    expect(levelSet(view(m), doc(), undefined, ASOF)!.fixed).toBeNull();
  });
});
