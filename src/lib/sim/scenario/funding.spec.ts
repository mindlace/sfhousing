import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../generator/seed';
import { PROTOTYPES, fundBundle, projectDollars, resolveTerms, uncoveredPerHome } from '../finance';
import type { Calibration, Pool, Programme } from '$lib/timelapse/types';
import { dayOf } from './dates';
import { runEngine } from './engine';
import {
  PIPELINE_FUNDED,
  asksOf,
  available,
  awardPasses,
  awardSet,
  below,
  checkFinance,
  coverageLevel,
  financeIndexOf,
  inflowArrivals,
  isOff,
  isOffered,
  leaveOut,
  newPoolState,
  type FinanceIndex
} from './funding';
import { benchBaseline, withBenchFunding } from './fixtures/bench-finance';
import { tinyStack } from './fixtures/tiny-queue';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import type { SimInput } from './types';

type Finance = NonNullable<SimInput['finance']>;

const A = dayOf(2026, 1, 1);

describe('inflowArrivals', () => {
  const asOf = dayOf(2024, 1, 1);
  const horizon = dayOf(2028, 3, 1);
  it('once: on asOf, before asOf, after the horizon', () => {
    expect(inflowArrivals({ kind: 'once', day: asOf, dollars: 1 }, asOf, horizon)).toEqual([asOf]);
    expect(inflowArrivals({ kind: 'once', day: asOf - 1, dollars: 1 }, asOf, horizon)).toEqual([]);
    expect(inflowArrivals({ kind: 'once', day: horizon + 1, dollars: 1 }, asOf, horizon)).toEqual(
      []
    );
  });
  it('yearly from 29 February lands on 28 February in common years', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2024, 2, 29), to: null, dollarsPerYear: 1 },
      asOf,
      horizon
    );
    expect(got).toEqual([
      dayOf(2024, 2, 29),
      dayOf(2025, 2, 28),
      dayOf(2026, 2, 28),
      dayOf(2027, 2, 28),
      dayOf(2028, 2, 29)
    ]);
  });
  it('yearly from before asOf starts at the first anniversary on or after asOf', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2020, 7, 1), to: null, dollarsPerYear: 1 },
      dayOf(2022, 1, 1),
      dayOf(2023, 12, 31)
    );
    expect(got).toEqual([dayOf(2022, 7, 1), dayOf(2023, 7, 1)]);
  });
  it('to is inclusive', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2026, 7, 1), to: dayOf(2028, 7, 1), dollarsPerYear: 1 },
      asOf,
      dayOf(2040, 1, 1)
    );
    expect(got).toHaveLength(3);
  });
  it('a to before the next anniversary gives one arrival', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2026, 7, 1), to: dayOf(2027, 6, 30), dollarsPerYear: 1 },
      asOf,
      dayOf(2040, 1, 1)
    );
    expect(got).toEqual([dayOf(2026, 7, 1)]);
  });
});

describe('PIPELINE_FUNDED', () => {
  it('is the spec 4.13 statement', () => {
    expect(PIPELINE_FUNDED).toEqual({
      tier: 4,
      label: 'Projects already in the pipeline are taken as funded',
      sources: [],
      method:
        'The simulation’s funding pools pay only for projects that start after the data date. ' +
        'Projects already in the pipeline are assumed to have their funding already, outside the ' +
        'pools, so the pools start with nothing committed: money the City has already committed to ' +
        'them is not subtracted. This overstates what the pools can fund in the first years.'
    });
  });
});

function tinyFinanceValid(): Finance {
  const pools: Pool[] = [
    {
      id: 'p-a',
      kind: 'generalRevenue',
      label: 'A',
      inflows: [{ kind: 'yearly', from: A, to: null, dollarsPerYear: 1000 }],
      uncapped: false,
      debt: null,
      leverage: 1
    },
    {
      id: 'p-b',
      kind: 'state',
      label: 'B',
      inflows: [{ kind: 'once', day: A, dollars: 500 }],
      uncapped: false,
      debt: null,
      leverage: 1
    },
    {
      id: 'fed',
      kind: 'federal',
      label: 'Fed',
      inflows: [],
      uncapped: true,
      debt: null,
      leverage: 1
    }
  ];
  const grant = (id: string, pool: string): Programme => ({
    id,
    label: id,
    pool,
    reach: 'market',
    instrument: { kind: 'grant', share: 0.5 },
    from: A,
    to: null,
    minHomes: 1,
    tiers: null
  });
  return {
    pools,
    programmes: [grant('g-a', 'p-a'), grant('g-b', 'p-b'), grant('g-fed', 'fed')],
    off: [],
    slope: 3,
    terms: resolveTerms()
  };
}

const withFinance = (finance: Finance): SimInput => ({ ...goldenInput(), finance });
const mutated = (f: (x: Finance) => void): SimInput => {
  const fin = tinyFinanceValid();
  f(fin);
  return withFinance(fin);
};
const bad = (input: SimInput, text: string) =>
  expect(() => checkFinance(input)).toThrow(new RangeError(text));

describe('checkFinance', () => {
  it('accepts a valid finance', () => {
    expect(() => checkFinance(withFinance(tinyFinanceValid()))).not.toThrow();
  });
  it('slope', () => {
    bad(
      mutated((f) => (f.slope = -1)),
      'finance.slope must be a finite number of 0 or more; got -1'
    );
    bad(
      mutated((f) => (f.slope = NaN)),
      'finance.slope must be a finite number of 0 or more; got NaN'
    );
  });
  it('repeated pool id', () => {
    bad(
      mutated((f) => (f.pools[1].id = 'p-a')),
      'finance.pools[1].id p-a is repeated'
    );
  });
  it('repeated programme id', () => {
    bad(
      mutated((f) => (f.programmes[1].id = 'g-a')),
      'finance.programmes[1].id g-a is repeated'
    );
  });
  it('programme names no pool', () => {
    bad(
      mutated((f) => (f.programmes[0].pool = 'nope')),
      'finance.programmes[0].pool nope names no pool'
    );
  });
  it('uncapped pool with inflows', () => {
    bad(
      mutated((f) => (f.pools[2].inflows = [{ kind: 'once', day: A, dollars: 1 }])),
      'finance.pools[2] (fed): an uncapped pool has no inflows'
    );
  });
  it('leverage', () => {
    bad(
      mutated((f) => (f.pools[0].leverage = 0)),
      'finance.pools[0] (p-a): leverage must be a finite number above 0; got 0'
    );
  });
  it('inflow dollars', () => {
    bad(
      mutated((f) => (f.pools[0].inflows = [{ kind: 'once', day: A, dollars: 1.5 }])),
      'finance.pools[0].inflows[0]: dollars must be a whole number of 0 or more'
    );
    bad(
      mutated(
        (f) => (f.pools[0].inflows = [{ kind: 'yearly', from: A, to: null, dollarsPerYear: -1 }])
      ),
      'finance.pools[0].inflows[0]: dollars must be a whole number of 0 or more'
    );
  });
  it('yearly inflow to before from', () => {
    bad(
      mutated(
        (f) => (f.pools[0].inflows = [{ kind: 'yearly', from: A, to: A - 1, dollarsPerYear: 1 }])
      ),
      'finance.pools[0].inflows[0]: to is before from'
    );
  });
  it('programme to before from', () => {
    bad(
      mutated((f) => {
        f.programmes[0].from = dayOf(2026, 1, 2);
        f.programmes[0].to = dayOf(2026, 1, 1);
      }),
      'finance.programmes[0] (g-a): to 2026-01-01 is before from 2026-01-02'
    );
  });
  it('debt required and forbidden', () => {
    bad(
      mutated((f) => (f.pools[0].kind = 'goBond')),
      'finance.pools[0] (p-a): debt is required for a goBond or cop pool'
    );
    bad(
      mutated((f) => (f.pools[0].debt = { rate: 0.05, termYears: 20 })),
      'finance.pools[0] (p-a): debt must be null for a generalRevenue pool'
    );
  });
  it('debt rate and term', () => {
    bad(
      mutated((f) => {
        f.pools[0].kind = 'cop';
        f.pools[0].debt = { rate: 0.3, termYears: 20 };
      }),
      'finance.pools[0] (p-a): debt.rate must be above 0 and at most 0.25; got 0.3'
    );
    bad(
      mutated((f) => {
        f.pools[0].kind = 'goBond';
        f.pools[0].debt = { rate: 0.05, termYears: 41 };
      }),
      'finance.pools[0] (p-a): debt.termYears must be a whole number from 1 to 40; got 41'
    );
  });
  it('minHomes', () => {
    const text = 'finance.programmes[0] (g-a): minHomes must be a whole number from 0 to 10000';
    bad(
      mutated((f) => (f.programmes[0].minHomes = 10001)),
      text
    );
    bad(
      mutated((f) => (f.programmes[0].minHomes = 2.5)),
      text
    );
  });
  it('invalid instrument', () => {
    bad(
      mutated((f) => (f.programmes[0].instrument = { kind: 'grant', share: 0 })),
      'finance.programmes[0] (g-a): A grant pays more than 0% and at most 100% of the uncovered cost.'
    );
  });
  it('missing term', () => {
    bad(
      mutated(
        (f) => (f.programmes[0].instrument = { kind: 'guarantee', costShare: 0.5, reserve: 0.2 })
      ),
      'finance.programmes[0] (g-a): guarantee needs guaranteeRateCut, which is not sourced'
    );
  });
  it('lossOnExit', () => {
    bad(
      mutated((f) => (f.terms = { ...f.terms, lossOnExit: null })),
      'finance.terms.lossOnExit must be between 0 and 1; got null'
    );
    bad(
      mutated((f) => (f.terms = { ...f.terms, lossOnExit: 1.5 })),
      'finance.terms.lossOnExit must be between 0 and 1; got 1.5'
    );
  });
  it('off names no pool, and off to before from', () => {
    bad(
      mutated((f) => (f.off = [{ pool: 'nope', from: A, to: null }])),
      'finance.off[0].pool nope names no pool'
    );
    bad(
      mutated((f) => (f.off = [{ pool: 'p-a', from: dayOf(2026, 1, 2), to: dayOf(2026, 1, 1) }])),
      'finance.off[0] (p-a): to 2026-01-01 is before from 2026-01-02'
    );
  });
  describe('affordable reach needs routes', () => {
    const text =
      'finance: the calibration has no affordableRoutes, but programme g-a reaches affordable projects';
    const affordable = (f: Finance) => {
      f.programmes[0].reach = 'affordable';
      f.programmes[0].tiers = { veryLow: 1, low: 0, moderate: 0, aboveModerate: 0 };
    };
    const routes = {
      discretionary: 0.3,
      streamlined: 0.6,
      permitOnly: 0.1,
      provenance: PIPELINE_FUNDED
    } as unknown as NonNullable<Calibration['affordableRoutes']>;
    it('throws on the calibration', () => {
      bad(mutated(affordable), text);
    });
    it('passes when the calibration has routes', () => {
      const input = mutated(affordable);
      input.calibration = { ...input.calibration, affordableRoutes: routes };
      expect(() => checkFinance(input)).not.toThrow();
    });
    it('checks newProjects.calibration when present', () => {
      const input = mutated(affordable);
      const cal = { ...input.calibration, affordableRoutes: routes };
      input.calibration = cal;
      input.newProjects = {
        calibration: { ...cal, affordableRoutes: undefined },
        scale: input.newProjects?.scale ?? ({} as never)
      };
      bad(input, text);
    });
  });
  it('the finance checks run once per finance object; the routes check every call', () => {
    const fin = tinyFinanceValid();
    let reads = 0;
    let slope = fin.slope;
    Object.defineProperty(fin, 'slope', {
      get() {
        reads++;
        return slope;
      },
      set(v: number) {
        slope = v;
      }
    });
    const input = withFinance(fin);
    checkFinance(input);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    checkFinance(input);
    expect(reads).toBe(afterFirst);
    fin.programmes[0].reach = 'affordable';
    expect(() => checkFinance(input)).toThrow(/no affordableRoutes/);
  });
});

describe('engine wiring', () => {
  it('throws before any sink call', () => {
    const calls: string[] = [];
    const input = mutated((f) => (f.slope = -1));
    expect(() =>
      runEngine(input, 1, GOLDEN_HORIZON, {
        schedule: () => void calls.push('schedule'),
        master: () => void calls.push('master'),
        ledger: () => void calls.push('ledger')
      } as never)
    ).toThrow(new RangeError('finance.slope must be a finite number of 0 or more; got -1'));
    expect(calls).toEqual([]);
  });
});

describe('coverage levels', () => {
  it('counts coverage up to 1 and compares with the tolerance', () => {
    expect(coverageLevel(1 - 5e-10)).toBe(1);
    expect(coverageLevel(0.5)).toBe(0.5);
    expect(below(0.5, 0.5 + 5e-10)).toBe(false);
    expect(below(0.5, 0.5 + 2e-9)).toBe(true);
  });
});

describe('isOff and isOffered', () => {
  const f = financeIndexOf(
    tinyStack({
      asOf: A,
      off: [
        { pool: 't-state', from: A + 10, to: A + 20 },
        { pool: 't-state', from: A + 15, to: A + 30 },
        { pool: 't-city', from: A + 50, to: null }
      ],
      cityTo: A + 80
    })
  );
  const state = f.poolOf.get('t-state')!;
  const city = f.poolOf.get('t-city')!;
  it('overlapping entries mean their union; to is inclusive; null is forever', () => {
    expect([9, 10, 20, 25, 30, 31].map((d) => isOff(f, state, A + d))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false
    ]);
    expect(isOff(f, city, A + 49)).toBe(false);
    expect(isOff(f, city, A + 1e9)).toBe(true);
  });
  it('a pool with no entry is never off', () => {
    expect(isOff(f, f.poolOf.get('t-fed')!, A + 15)).toBe(false);
  });
  it('a programme is offered when active and its pool is on', () => {
    const g = f.finance.programmes.findIndex((p) => p.id === 't-city');
    expect(isOffered(f, g, A - 1)).toBe(false);
    expect(isOffered(f, g, A)).toBe(true);
    expect(isOffered(f, g, A + 49)).toBe(true);
    expect(isOffered(f, g, A + 50)).toBe(false);
    const s = f.finance.programmes.findIndex((p) => p.id === 't-state');
    expect(isOffered(f, s, A + 10)).toBe(false);
    expect(isOffered(f, s, A + 31)).toBe(true);
  });
  it('a programme is not offered after its own end', () => {
    const g = financeIndexOf(tinyStack({ asOf: A, cityTo: A + 5 }));
    expect(isOffered(g, 2, A + 5)).toBe(true);
    expect(isOffered(g, 2, A + 6)).toBe(false);
  });
});

describe('available', () => {
  const pool = (over: Partial<Pool>): Pool => ({
    id: 'x',
    kind: 'bank',
    label: 'x',
    inflows: [],
    uncapped: false,
    debt: null,
    leverage: 0.8,
    ...over
  });
  it('is leverage times received less everything held, spent, out and lost', () => {
    const s = {
      received: 1000,
      committed: 100,
      spentGrant: 50,
      outLoan: 200,
      lostLoan: 10,
      lostGuarantee: 5
    };
    expect(available(pool({}), s)).toBeCloseTo(0.8 * 1000 - 100 - 50 - 200 - 10 - 5, 9);
    expect(available(pool({ uncapped: true, leverage: 1 }), s)).toBe(Infinity);
    expect(available(pool({}), newPoolState())).toBe(0);
  });
});

describe('the award rule', () => {
  const U = uncoveredPerHome('affordable', PROTOTYPES[0]);
  const proto = PROTOTYPES[0].id;
  const u = 10;
  const ample = (): Finance => tinyStack({ asOf: A });
  const bundleOf = (f: FinanceIndex) => f.finance.programmes.map((_, i) => i);
  const availOf =
    (f: FinanceIndex, over: Record<string, number>) =>
    (q: number): number =>
      over[f.finance.pools[q].id] ?? 1e15;
  const withShares = (fin: Finance, shares: Record<string, number>): Finance => ({
    ...fin,
    programmes: fin.programmes.map((g) =>
      g.id in shares ? { ...g, instrument: { kind: 'grant', share: shares[g.id] } } : g
    )
  });
  const bondStack = (share: number) =>
    tinyStack({
      asOf: A,
      bond: {
        share,
        from: A,
        inflows: [{ kind: 'yearly', from: A, to: null, dollarsPerYear: 1_000_000_000_000 }]
      }
    });
  const names = (f: FinanceIndex, set: number[]) => set.map((g) => f.finance.programmes[g].id);

  it('a bond in the City tier splits what the tier has left', () => {
    const f = financeIndexOf(bondStack(0.5));
    const r = f.price('affordable', bundleOf(f), proto);
    expect(Math.abs(r.coverage - 1)).toBeLessThan(1e-9);
    expect(r.items[2].granted).toBeCloseTo(123176.65, 2);
    expect(r.items[3].granted).toBeCloseTo(176850.35, 2);
    expect(r.items[2].granted + r.items[3].granted).toBeCloseTo(300027, 2);
  });
  it('City short, bond 0.5: the bond covers the City tier alone', () => {
    const f = financeIndexOf(bondStack(0.5));
    const B = bundleOf(f);
    const city = f.poolOf.get('t-city')!;
    const asks = asksOf(f, 'affordable', B, proto, u);
    const got = awardSet(
      B,
      'affordable',
      proto,
      u,
      availOf(f, { 't-city': asks.get(city)! - 1 }),
      f
    );
    expect(got).not.toBeNull();
    expect(names(f, got!.set)).toEqual(['t-fed', 't-state', 't-bond-grant']);
    expect(got!.priced.certain).toBe(true);
    expect(got!.priced.items[2].granted).toBeCloseTo(300027, 2);
    expect(
      Math.abs(got!.asks.get(f.poolOf.get('t-bond')!)! - projectDollars(300027, u))
    ).toBeLessThanOrEqual(u);
  });
  it('City short, bond 0.2: the project waits', () => {
    const f = financeIndexOf(bondStack(0.2));
    const B = bundleOf(f);
    const avail = availOf(f, { 't-city': 0 });
    expect(awardSet(B, 'affordable', proto, u, avail, f)).toBeNull();
    const left = leaveOut(B, 'affordable', proto, u, avail, f);
    expect(names(f, left.set)).toEqual(['t-fed', 't-state', 't-bond-grant']);
    expect(f.price('affordable', left.set, proto).coverage).toBeCloseTo(
      (443108 + 118390 + 172305) / 861525,
      9
    );
  });
  it('bond short: the City grant pays its full share again', () => {
    const f = financeIndexOf(bondStack(0.5));
    const got = awardSet(bundleOf(f), 'affordable', proto, u, availOf(f, { 't-bond': 0 }), f);
    expect(names(f, got!.set)).toEqual(['t-fed', 't-state', 't-city']);
    expect(got!.priced.certain).toBe(true);
  });
  it('an exact fit is awarded; one dollar less leaves the pool', () => {
    const f = financeIndexOf(bondStack(0.5));
    const B = bundleOf(f);
    const asks = asksOf(f, 'affordable', B, proto, u);
    const exact: Record<string, number> = {};
    for (const [q, ask] of asks) exact[f.finance.pools[q].id] = ask;
    expect(awardSet(B, 'affordable', proto, u, availOf(f, exact), f)!.set).toEqual(B);
    const city = f.poolOf.get('t-city')!;
    const less = { ...exact, 't-city': asks.get(city)! - 1 };
    expect(names(f, leaveOut(B, 'affordable', proto, u, availOf(f, less), f).set)).not.toContain(
      't-city'
    );
  });
  it('a short pool in a later round: cascade across tiers', () => {
    const fin = withShares(ample(), { 't-fed': 0.5, 't-state': 0.3, 't-city': 0.5 });
    const f = financeIndexOf(fin);
    const B = bundleOf(f);
    const lo = projectDollars(0.2 * U, u);
    const hi = projectDollars(0.5 * U, u) - 1;
    const avail = availOf(f, { 't-state': 0, 't-city': Math.floor((lo + hi) / 2) });
    expect(Math.floor((lo + hi) / 2)).toBeGreaterThanOrEqual(lo);
    const left = leaveOut(B, 'affordable', proto, u, avail, f);
    expect(left).toEqual({ set: [0], rounds: 2 });
    expect(awardSet(B, 'affordable', proto, u, avail, f)).toBeNull();
  });
  it('a short pool in a later round: cascade within a tier', () => {
    const base = withShares(ample(), { 't-city': 0.4 });
    const city2: Pool = { ...base.pools[2], id: 't-city2' };
    const fin: Finance = {
      ...base,
      pools: [...base.pools, city2],
      programmes: [...base.programmes, { ...base.programmes[2], id: 't-city2', pool: 't-city2' }]
    };
    const f = financeIndexOf(fin);
    const B = bundleOf(f);
    const each = 0.174 * U * u;
    const avail = availOf(f, { 't-city': each * 0.5, 't-city2': each * 1.5 });
    const left = leaveOut(B, 'affordable', proto, u, avail, f);
    expect(left).toEqual({ set: [0, 1], rounds: 2 });
    expect(awardSet(B, 'affordable', proto, u, avail, f)).toBeNull();
  });
  const loanStack = (): Finance => {
    const base = ample();
    const pool: Pool = {
      id: 't-loan',
      kind: 'generalRevenue',
      label: 'loan',
      inflows: [],
      uncapped: false,
      debt: null,
      leverage: 1
    };
    const prog: Programme = {
      ...base.programmes[2],
      id: 't-loan',
      pool: 't-loan',
      instrument: { kind: 'loan', costShare: 1, rate: 0, requiredReturn: 0.01 }
    };
    return { ...base, pools: [...base.pools, pool], programmes: [...base.programmes, prog] };
  };
  it('a loan that is short while coverage is above 1 leaves and the award stands', () => {
    const f = financeIndexOf(loanStack());
    const B = bundleOf(f);
    expect(f.price('affordable', B, proto).coverage).toBeGreaterThan(1);
    const got = awardSet(B, 'affordable', proto, u, availOf(f, { 't-loan': 0 }), f);
    expect(names(f, got!.set)).toEqual(['t-fed', 't-state', 't-city']);
    expect(got!.priced.certain).toBe(true);
  });
  it('waits when every capped pool is short', () => {
    const f = financeIndexOf(ample());
    const avail = availOf(f, { 't-state': 0, 't-city': 0 });
    expect(awardSet([1, 2], 'affordable', proto, u, avail, f)).toBeNull();
  });
  it('an empty bundle, or a zero-coverage loan on a short pool, is never awarded', () => {
    const f = financeIndexOf(ample());
    expect(awardSet([], 'affordable', proto, u, () => 1e15, f)).toBeNull();
    const base = loanStack();
    const zero: Finance = {
      ...base,
      programmes: base.programmes.map((g) =>
        g.id === 't-loan'
          ? { ...g, instrument: { kind: 'loan', costShare: 1, rate: 0.25, requiredReturn: null } }
          : g
      )
    };
    const fz = financeIndexOf(zero);
    expect(fz.price('affordable', [3], proto).coverage).toBe(0);
    expect(awardSet([3], 'affordable', proto, u, availOf(fz, { 't-loan': 0 }), fz)).toBeNull();
  });
  it('the price memo returns one result per set, and the affordable kind ignores the prototype', () => {
    const f = financeIndexOf(ample());
    expect(f.price('affordable', [0, 1], PROTOTYPES[0].id)).toBe(
      f.price('affordable', [0, 1], PROTOTYPES[4].id)
    );
    expect(financeIndexOf(f.finance)).toBe(f);
  });
});

describe('the award rule is monotone (property)', () => {
  const proto = PROTOTYPES[0].id;
  const base = tinyStack({
    asOf: A,
    bond: {
      share: 0.3,
      from: A,
      inflows: [{ kind: 'yearly', from: A, to: null, dollarsPerYear: 1_000_000_000_000 }]
    }
  });
  const capped = (id: string): Pool => ({
    id,
    kind: 'generalRevenue',
    label: id,
    inflows: [],
    uncapped: false,
    debt: null,
    leverage: 1
  });
  const finance = (costShare: number, rate: number, reserve: number): Finance => ({
    ...base,
    terms: resolveTerms(undefined, { guaranteeRateCut: 0.02 }),
    pools: [...base.pools, capped('t-loan'), capped('t-guar')],
    programmes: [
      ...base.programmes,
      {
        ...base.programmes[2],
        id: 't-loan',
        pool: 't-loan',
        instrument: { kind: 'loan', costShare, rate, requiredReturn: null }
      },
      {
        ...base.programmes[2],
        id: 't-guar',
        pool: 't-guar',
        instrument: { kind: 'guarantee', costShare, reserve }
      }
    ]
  });
  it('lower money or a larger size never turns a failure into an award', () => {
    const rng = mulberry32(0x7a11);
    let nulls = 0;
    let awards = 0;
    for (let n = 0; n < 500; n++) {
      const fin = finance(0.05 + 0.9 * rng(), 0.1 * rng(), rng());
      const f = financeIndexOf(fin);
      const P = fin.programmes.length;
      const bundle = [...Array(P).keys()].filter(() => rng() < 0.7);
      const units = 1 + Math.floor(rng() * 200);
      const hi = fin.pools.map(() => (rng() < 0.2 ? 1e15 : Math.floor(rng() * 2e8)));
      const lo = hi.map((a) => Math.floor(a * rng()));
      const hiAvail = (q: number) => hi[q];
      const loAvail = (q: number) => lo[q];
      const atHi = awardSet(bundle, 'affordable', proto, units, hiAvail, f);
      const atLo = awardSet(bundle, 'affordable', proto, units, loAvail, f);
      if (atHi === null) {
        nulls++;
        expect(atLo).toBeNull();
      } else awards++;
      const setHi = leaveOut(bundle, 'affordable', proto, units, hiAvail, f).set;
      const setLo = leaveOut(bundle, 'affordable', proto, units, loAvail, f).set;
      expect(setLo.every((g) => setHi.includes(g))).toBe(true);
      const bigger = units + 1 + Math.floor(rng() * 100);
      if (atHi === null) {
        expect(awardSet(bundle, 'affordable', proto, bigger, hiAvail, f)).toBeNull();
      }
      if (atHi) {
        const direct = fundBundle(
          atHi.set.map((g) => ({
            instrument: fin.programmes[g].instrument,
            poolKind: fin.pools[f.progPool[g]].kind
          })),
          'affordable',
          PROTOTYPES[0],
          fin.terms
        );
        expect(atHi.priced).toEqual(direct);
      }
    }
    expect(nulls).toBeGreaterThan(20);
    expect(awards).toBeGreaterThan(20);
  });
});

describe('awardPasses', () => {
  it('awardPasses agrees with awardSet on random bundles and money', () => {
    const fin = withBenchFunding(benchBaseline(A), A);
    const f = financeIndexOf(fin);
    const byKind = (kind: 'market' | 'affordable') =>
      fin.programmes.map((g, i) => (g.reach === kind ? i : -1)).filter((i) => i >= 0);
    const reach = { market: byKind('market'), affordable: byKind('affordable') };
    // the engine passes the same bundle arrays again and again: keep some to reuse
    const kept: { market: number[][]; affordable: number[][] } = { market: [], affordable: [] };
    const rng = mulberry32(0xa3a7d);
    let passes = 0;
    let fails = 0;
    let leftOut = 0;
    for (let n = 0; n < 2000; n++) {
      const kind = rng() < 0.5 ? 'market' : 'affordable';
      const protoId = PROTOTYPES[Math.floor(rng() * PROTOTYPES.length)].id;
      let bundle: number[];
      if (kept[kind].length > 0 && rng() < 0.4) {
        bundle = kept[kind][Math.floor(rng() * kept[kind].length)];
      } else {
        bundle = reach[kind].filter(() => rng() < 0.6);
        if (bundle.length === 0) bundle = [reach[kind][Math.floor(rng() * reach[kind].length)]];
        kept[kind].push(bundle);
      }
      const units = 1 + Math.floor(rng() * 400);
      const asks = asksOf(f, kind, bundle, protoId, units);
      const money = fin.pools.map((_, q) => {
        const ask = asks.get(q) ?? Math.floor(rng() * 1e8);
        const r = rng();
        // sometimes exactly the ask, sometimes 0, else 0 to 2x the ask
        return r < 0.1 ? ask : r < 0.15 ? 0 : Math.floor(2 * ask * rng());
      });
      const avail = (q: number) => money[q];
      const want = awardSet(bundle, kind, protoId, units, avail, f) !== null;
      expect(awardPasses(bundle, kind, protoId, units, avail, f), `case ${n}`).toBe(want);
      if (want) passes++;
      else fails++;
      if (leaveOut(bundle, kind, protoId, units, avail, f).rounds > 0) leftOut++;
    }
    expect(passes).toBeGreaterThan(200);
    expect(fails).toBeGreaterThan(200);
    expect(leftOut).toBeGreaterThan(200);
  });
});
