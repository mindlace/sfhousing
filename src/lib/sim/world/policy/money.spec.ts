import { describe, expect, it } from 'vitest';
import { buildFinance } from '$lib/sim/levers/finance';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { financeIndexOf } from '$lib/sim/scenario/funding';
import { Treasury, type LedgerEvent } from '$lib/sim/scenario/money';
import type { SimInput } from '$lib/sim/scenario/types';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, Programme } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay, monthOfDay } from '../months';
import { inForceAt, moneyLeversOf } from './combine';
import type { FinanceFrame } from './frame';
import { createMoneyTrack, moneyOrder } from './money';
import {
  AS_OF,
  baselinePolicy,
  fundPolicy,
  miniDoc,
  off,
  termsPolicy,
  type Months
} from './test/fixtures';

type Finance = NonNullable<SimInput['finance']>;
const BASE = (): Finance => baselineFixture(AS_OF).finance;
const BASE_POOLS = ['city-a', 'city-b', 'state', 'federal'];
const BASE_PROGS = BASE_POOLS.map((p) => `baseline-${p}`);
const first = (m: number) => monthFirstDay(AS_OF, m);

/** An added pool with `inflows`. */
const pool = (id: string, inflows: Inflow[] = []): Pool => ({
  ...structuredClone(fundingOnly().pools[0]),
  id,
  label: id,
  inflows
});

/** An added programme on `poolId`, offered from the dataset date. */
const prog = (id: string, poolId: string, over: Partial<Programme> = {}): Programme => ({
  ...structuredClone(fundingOnly().programmes[0]),
  id,
  label: id,
  pool: poolId,
  from: AS_OF,
  ...over
});

/** A fund policy for one added pool and its one programme. */
const fund = (id: string, p: Pool, g: Omit<Programme, 'pool'>[], months?: Months) =>
  fundPolicy(
    id,
    p.id,
    p,
    g.map((x) => ({ ...x, pool: p.id })),
    months
  );

/** The money frames and keys of months 1..n, levers as the compiler takes them. */
function track(doc: SimPolicy4, n: number, finance: Finance = BASE()) {
  const t = createMoneyTrack(doc, { asOf: AS_OF, finance });
  return Array.from({ length: n }, (_, k) => {
    const r = t.month(k + 1, moneyLeversOf(inForceAt(doc, first(k + 1))));
    expect(r).not.toBeNull();
    return r!;
  });
}

/**
 * Checks that 120 months of arrivals of `doc` (levers constant over the run) are what `Treasury`
 * receives over the same days, each within its month; returns them as `[day, pool id, dollars]`.
 */
function sameAsTreasury(doc: SimPolicy4, base: Finance) {
  const N = 120;
  const rs = track(doc, N, structuredClone(base));
  const fin = buildFinance(base, moneyLeversOf(inForceAt(doc, first(1))), AS_OF)!;
  const events: LedgerEvent[] = [];
  const days: Day[] = [];
  const t = new Treasury(
    financeIndexOf(fin),
    AS_OF,
    monthLastDay(AS_OF, N),
    0,
    (e) => events.push(e),
    (d) => days.push(d)
  );
  for (const d of [...new Set(days)].sort((a, b) => a - b)) t.receive(d);
  const want = events.map((e) => [e.day, e.pool, e.dollars]);
  expect(want.length).toBeGreaterThan(10);

  const got = rs.flatMap(({ frame }) =>
    frame.arrivals
      .filter((a) => a.dollars !== 0)
      .map((a) => [a.day, frame.pools[a.pool].id, a.dollars])
  );
  expect(got).toEqual(want);
  rs.forEach(({ frame }, k) => {
    const lo = k === 0 ? AS_OF : first(k + 1);
    for (const a of frame.arrivals) {
      expect(a.day).toBeGreaterThanOrEqual(lo);
      expect(a.day).toBeLessThanOrEqual(monthLastDay(AS_OF, k + 1));
    }
  });
  return got;
}

const progAt = (f: FinanceFrame, id: string) => f.programmes.findIndex((g) => g.id === id);
const offeredOf = (rs: { frame: FinanceFrame }[], id: string) =>
  rs.map(({ frame }) => frame.offered[progAt(frame, id)]);

describe('moneyOrder and the frame order (rule 15)', () => {
  it('baseline first, then added in document order, one entry per id, every month', () => {
    const doc = miniDoc(
      fund(
        'f-a',
        pool('u-a'),
        [prog('u-pa', 'u-a')],
        [
          [1, 3],
          [6, null]
        ]
      ),
      fundPolicy('f-b', 'city-b', null, [prog('u-pb', 'city-b')], [[2, null]]),
      off(fund('f-c', pool('u-c'), [prog('u-pc', 'u-c')]))
    );
    const order = moneyOrder(doc, BASE());
    expect(order).toEqual({
      pools: [...BASE_POOLS, 'u-a', 'u-c'],
      programmes: [...BASE_PROGS, 'u-pa', 'u-pb', 'u-pc']
    });
    for (const { frame } of track(doc, 8)) {
      expect(frame.pools.map((p) => p.id)).toEqual(order.pools);
      expect(frame.programmes.map((g) => g.id)).toEqual(order.programmes);
      expect(frame.offered).toHaveLength(order.programmes.length);
    }
  });
});

describe('definitions', () => {
  it('the definition in force, else the last in force, else the first span', () => {
    const p = fund(
      'f',
      pool('u-a'),
      [prog('u-pa', 'u-a', { minHomes: 3 })],
      [
        [3, 5],
        [8, null]
      ]
    );
    const second = p.spans[1].what;
    if (second.tag !== 'fund') throw new Error('fixture');
    second.programmes[0].minHomes = 5;
    const rs = track(miniDoc(p), 10);
    expect(rs.map(({ frame }) => frame.programmes[progAt(frame, 'u-pa')].minHomes)).toEqual([
      3, 3, 3, 3, 3, 3, 3, 5, 5, 5
    ]);
    expect(offeredOf(rs, 'u-pa')).toEqual([0, 0, 1, 1, 1, 0, 0, 1, 1, 1]);
    const offRs = track(miniDoc(off(p)), 10);
    expect(offRs.map(({ frame }) => frame.programmes[progAt(frame, 'u-pa')].minHomes)).toEqual(
      Array(10).fill(3)
    );
    expect(offeredOf(offRs, 'u-pa')).toEqual(Array(10).fill(0));
  });

  it('a month with the same levers reuses the one buildFinance', () => {
    const doc = miniDoc(baselinePolicy('b', [{ pool: 'state', from: AS_OF, scale: 2 }]));
    const rs = track(doc, 3);
    expect(rs[1].frame.pools[2]).toBe(rs[0].frame.pools[2]);
    expect(rs[2].frame.pools[2]).toBe(rs[0].frame.pools[2]);
    expect(rs[0].frame.pools[2]).not.toBe(BASE().pools[2]);
  });
});

describe('offered (rule 7)', () => {
  it('offered on the first day only', () => {
    const doc = miniDoc(
      fund('f', pool('u-a'), [prog('u-pa', 'u-a', { to: first(4) + 9 })]),
      baselinePolicy('b', [
        { pool: 'city-a', from: first(5) + 9, scale: 0 },
        { pool: 'city-b', from: first(3), scale: 0 }
      ])
    );
    const rs = track(doc, 6);
    expect(offeredOf(rs, 'u-pa')).toEqual([1, 1, 1, 1, 0, 0]);
    expect(offeredOf(rs, 'baseline-city-b')).toEqual([1, 1, 0, 0, 0, 0]);
    expect(offeredOf(rs, 'baseline-city-a')).toEqual([1, 1, 1, 1, 1, 0]);
    expect(offeredOf(rs, 'baseline-state')).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe('arrivals', () => {
  it('equal what Treasury receives, month by month, off days skipped', () => {
    const fo = fundingOnly();
    const added = pool('u-pool-1', [
      ...fo.pools[0].inflows,
      { kind: 'yearly', from: AS_OF + 45, to: null, dollarsPerYear: 500_000 }
    ]);
    const doc = miniDoc(
      baselinePolicy('b', [
        ...fo.baselineScale,
        { pool: 'city-b', from: AS_OF + 700, scale: 0 },
        { pool: 'city-b', from: AS_OF + 1200, scale: 1 }
      ]),
      fund('f', added, fo.programmes)
    );
    const got = sameAsTreasury(doc, BASE());
    const cityB = got.filter(([d, p]) => p === 'city-b' && +d >= AS_OF + 700 && +d < AS_OF + 1200);
    expect(cityB).toEqual([]);
  });

  it('skip the dataset off days (miniFinance)', () => {
    const base = miniFinance(AS_OF);
    base.off.push({ pool: 'm-bank', from: AS_OF + 390, to: AS_OF + 410 });
    const doc = miniDoc(
      baselinePolicy('b', [{ pool: 'm-city', from: AS_OF + 200, scale: 0.5 }]),
      fund('f', pool('u-a', [{ kind: 'once', day: AS_OF + 30, dollars: 9 }]), []),
      termsPolicy('t', { guaranteeRateCut: 0.01 }) // miniFinance's guarantee needs it
    );
    const got = sameAsTreasury(doc, base);
    expect(got.filter(([, p]) => p === 'm-bank')).toEqual([]);
    expect(got.filter(([, p]) => p === 'u-a')).toEqual([[AS_OF + 30, 'u-a', 9]]);
  });

  it('dataset-date inflow once, month 1', () => {
    const doc = miniDoc(
      fund('f', pool('u-d', [{ kind: 'once', day: AS_OF, dollars: 7_000 }]), [prog('u-pd', 'u-d')])
    );
    const rs = track(doc, 24);
    const hits = rs.flatMap(({ frame }, k) =>
      frame.arrivals
        .filter((a) => frame.pools[a.pool].id === 'u-d')
        .map((a) => [k + 1, a.day, a.dollars])
    );
    expect(hits).toEqual([[1, AS_OF, 7_000]]);
  });

  it('within a day, by frame pool index', () => {
    const doc = miniDoc(fund('f', pool('u-a', [{ kind: 'once', day: AS_OF, dollars: 1 }]), []));
    const day1 = track(doc, 1)[0].frame.arrivals.filter((a) => a.day === AS_OF);
    expect(day1.map((a) => a.pool)).toEqual([0, 1, 2, 4]);
  });
});

describe('spans cut settings (rule 6)', () => {
  const stateIn = (rs: { frame: FinanceFrame }[], m: number) =>
    rs[m - 1].frame.arrivals.filter((a) => a.pool === 2).map((a) => a.dollars);
  const anniversary = monthOfDay(AS_OF, AS_OF + 365);

  it('a scale entry dated before the span applies from the span month only', () => {
    const entry = [{ pool: 'state', from: AS_OF - 10, scale: 2 }];
    const late = track(miniDoc(baselinePolicy('b', entry, [[5, null]])), anniversary);
    expect(stateIn(late, 1)).toEqual([3_000_000]);
    expect(stateIn(late, anniversary)).toEqual([6_000_000]);
    const always = track(miniDoc(baselinePolicy('b', entry)), 1);
    expect(stateIn(always, 1)).toEqual([6_000_000]);
  });

  it('an added pool receives only in months its fund policy is in force', () => {
    const inflows: Inflow[] = [2, 6, 9].map((m) => ({
      kind: 'once',
      day: first(m) + 3,
      dollars: 100 * m
    }));
    const rs = track(miniDoc(fund('f', pool('u-a', inflows), [], [[4, 8]])), 10);
    const got = rs.flatMap(({ frame }, k) =>
      frame.arrivals.filter((a) => a.pool === 4).map((a) => [k + 1, a.dollars])
    );
    expect(got).toEqual([[6, 600]]);
  });
});

describe('identity key (rule 16)', () => {
  const N = 24;
  const D0 = () =>
    fund('f', pool('u-pool-1', [{ kind: 'once', day: AS_OF + 100, dollars: 1_000_000 }]), [
      prog('u-prog-1', 'u-pool-1')
    ]);
  const keys = (doc: SimPolicy4) => track(doc, N).map((r) => r.key);

  it('raising an inflow changes arrivals, not keys', () => {
    const raised = D0();
    const w = raised.spans[0].what;
    if (w.tag !== 'fund' || w.pool === null) throw new Error('fixture');
    w.pool.inflows = [{ kind: 'once', day: AS_OF + 100, dollars: 2_000_000 }];
    const a = track(miniDoc(D0()), N);
    const b = track(miniDoc(raised), N);
    expect(b.map((r) => r.key)).toEqual(a.map((r) => r.key));
    const m = monthOfDay(AS_OF, AS_OF + 100);
    expect(b[m - 1].frame.arrivals).not.toEqual(a[m - 1].frame.arrivals);
  });

  it('a fund from month 10 leaves earlier keys and changes month 10', () => {
    const a = keys(miniDoc(D0()));
    const b = keys(miniDoc(D0(), fund('g', pool('u-g'), [prog('u-pg', 'u-g')], [[10, null]])));
    expect(b.slice(0, 9)).toEqual(a.slice(0, 9));
    expect(b[9]).not.toBe(a[9]);
  });

  it('a programme setting changed in a span from month 10 changes keys from 10 only', () => {
    const two = () => {
      const p = D0();
      p.spans = [
        { ...structuredClone(p.spans[0]), to: monthLastDay(AS_OF, 9) },
        { ...structuredClone(p.spans[0]), from: first(10) }
      ];
      return p;
    };
    const edited = two();
    const w = edited.spans[1].what;
    if (w.tag !== 'fund') throw new Error('fixture');
    w.programmes[0].minHomes = 4;
    const a = keys(miniDoc(two()));
    const b = keys(miniDoc(edited));
    expect(b.slice(0, 9)).toEqual(a.slice(0, 9));
    for (let k = 9; k < N; k++) expect(b[k]).not.toBe(a[k]);
  });

  it('a programme not on offer changes no key', () => {
    const a = keys(miniDoc(D0()));
    const later = fund('h', pool('u-h'), [prog('u-ph', 'u-h', { from: first(30) })]);
    expect(keys(miniDoc(D0(), later))).toEqual(a);
    const switched = fund('k', pool('u-k'), [prog('u-pk', 'u-k')]);
    expect(keys(miniDoc(D0(), off(switched)))).toEqual(a);
  });

  it('terms in force from month 5 change keys from 5', () => {
    const a = keys(miniDoc(D0()));
    const b = keys(miniDoc(D0(), termsPolicy('t', { constructionRate: 0.07 }, [[5, null]])));
    expect(b.slice(0, 4)).toEqual(a.slice(0, 4));
    expect(b[4]).not.toBe(a[4]);
  });
});

describe('without finance', () => {
  it('month is null', () => {
    const doc = miniDoc(fund('f', pool('u-a'), [prog('u-pa', 'u-a')]));
    const t = createMoneyTrack(doc, { asOf: AS_OF, finance: undefined });
    expect(t.month(1, moneyLeversOf(inForceAt(doc, first(1))))).toBeNull();
  });
});
