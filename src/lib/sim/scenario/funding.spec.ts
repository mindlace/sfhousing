import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../generator/seed';
import {
  PROTOTYPES,
  fundBundle,
  oddsShift,
  projectDollars,
  resolveTerms,
  uncoveredPerHome
} from '../finance';
import type { Pool, PoolKind, Programme } from '$lib/timelapse/types';
import { dayOf } from './dates';
import {
  PIPELINE_FUNDED,
  asksOf,
  awardPasses,
  awardSet,
  below,
  cappedShift,
  coverageLevel,
  financeIndexOf,
  inflowArrivals,
  isOff,
  isOffered,
  leaveOut,
  lineKey,
  type FinanceIndex
} from './funding';
import { benchBaseline, withBenchFunding } from './fixtures/bench-finance';
import { tinyStack } from './fixtures/tiny-queue';
import type { SimInput } from './types';

const P19 = 524_288;
const P20 = 1_048_576;
const P28 = 268_435_456;

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
  it('City short, bond 0.2: awarded on the federal, state and bond grants', () => {
    const f = financeIndexOf(bondStack(0.2));
    const B = bundleOf(f);
    const avail = availOf(f, { 't-city': 0 });
    const got = awardSet(B, 'affordable', proto, u, avail, f);
    expect(got).not.toBeNull();
    expect(names(f, got!.set)).toEqual(['t-fed', 't-state', 't-bond-grant']);
    expect(got!.priced.coverage).toBeCloseTo((443108 + 118390 + 172305) / 861525, 9);
    expect(got!.priced.certain).toBe(false);
    expect(awardPasses(B, 'affordable', proto, u, avail, f)).toBe(true);
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
    expect(awardSet(B, 'affordable', proto, u, avail, f)!.set).toEqual([0]);
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
    expect(awardSet(B, 'affordable', proto, u, avail, f)!.set).toEqual([0, 1]);
  });
  const loanStack = (): Finance => {
    const base = ample();
    const pool: Pool = {
      id: 't-loan',
      kind: 'generalRevenue',
      label: 'loan',
      inflows: [],
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
  it('an application short on the federal pool is awarded on the others', () => {
    const f = financeIndexOf(ample());
    const B = bundleOf(f);
    const fed = f.poolOf.get('t-fed')!;
    const asks = asksOf(f, 'affordable', B, proto, u);
    expect(asks.get(fed)).toBeGreaterThan(0);
    const short = availOf(f, { 't-fed': asks.get(fed)! - 1 });
    expect(names(f, leaveOut(B, 'affordable', proto, u, short, f).set)).toEqual([
      't-state',
      't-city'
    ]);
    expect(names(f, awardSet(B, 'affordable', proto, u, short, f)!.set)).toEqual([
      't-state',
      't-city'
    ]);
    expect(awardPasses(B, 'affordable', proto, u, short, f)).toBe(true);
    const exact = availOf(f, { 't-fed': asks.get(fed)! });
    expect(awardSet(B, 'affordable', proto, u, exact, f)!.set).toEqual(B);
  });
  it('waits when every pool is short', () => {
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
  it('a set at level 0 is never awarded, whole or partial', () => {
    const base = loanStack();
    const fz = financeIndexOf({
      ...base,
      programmes: base.programmes.map((g) =>
        g.id === 't-loan'
          ? { ...g, instrument: { kind: 'loan', costShare: 1, rate: 0.25, requiredReturn: null } }
          : g
      )
    });
    const ample = availOf(fz, {});
    // whole: the zero-coverage loan alone, with ample money
    expect(fz.price('affordable', [3], proto).coverage).toBe(0);
    expect(awardSet([3], 'affordable', proto, u, ample, fz)).toBeNull();
    expect(awardPasses([3], 'affordable', proto, u, ample, fz)).toBe(false);
    // partial: the City grant and that loan, the City short, leave the loan alone
    const cityShort = availOf(fz, { 't-city': 0 });
    expect(leaveOut([2, 3], 'affordable', proto, u, cityShort, fz).set).toEqual([3]);
    expect(awardSet([2, 3], 'affordable', proto, u, cityShort, fz)).toBeNull();
    expect(awardPasses([2, 3], 'affordable', proto, u, cityShort, fz)).toBe(false);
  });
  it('cappedShift: coverage above 1 shifts as coverage 1', () => {
    const f = financeIndexOf(loanStack());
    const P = PROTOTYPES[0];
    const priced = f.price('affordable', bundleOf(f), P.id);
    expect(priced.coverage).toBeGreaterThan(1);
    for (const slope of [1, 3]) {
      const full = oddsShift(uncoveredPerHome('affordable', P), 'affordable', P, slope);
      expect(cappedShift(priced, 'affordable', P, slope)).toBe(full);
      expect(oddsShift(priced.grantEquivalent, 'affordable', P, slope)).toBeGreaterThan(full);
    }
  });
  it('cappedShift: below coverage 1 it is oddsShift', () => {
    const base = ample();
    const pool = base.pools[2].id;
    const market: Programme = {
      ...base.programmes[2],
      id: 't-market-loan',
      pool,
      reach: 'market',
      instrument: { kind: 'loan', costShare: 0.3, rate: 0.02, requiredReturn: null },
      tiers: null
    };
    const f = financeIndexOf({ ...base, programmes: [...base.programmes, market] });
    let checked = 0;
    for (const P of PROTOTYPES) {
      const cases = [
        ['affordable', [0, 1]],
        ['market', [3]]
      ] as const;
      for (const [kind, set] of cases) {
        const priced = f.price(kind, set, P.id);
        expect(priced.coverage).toBeGreaterThan(0);
        expect(priced.coverage).toBeLessThan(1);
        expect(cappedShift(priced, kind, P, 3)).toBe(oddsShift(priced.grantEquivalent, kind, P, 3));
        checked++;
      }
    }
    expect(checked).toBe(2 * PROTOTYPES.length);
  });
  it('the price memo returns one result per set, and the affordable kind ignores the prototype', () => {
    const f = financeIndexOf(ample());
    expect(f.price('affordable', [0, 1], PROTOTYPES[0].id)).toBe(
      f.price('affordable', [0, 1], PROTOTYPES[4].id)
    );
    expect(financeIndexOf(f.finance)).toBe(f);
  });
});

/** The award properties' finance: the tiny stack with a 0.3 bond, a capped loan and guarantee. */
const propBase = tinyStack({
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
  debt: null,
  leverage: 1
});
const propFinance = (costShare: number, rate: number, reserve: number): Finance => ({
  ...propBase,
  terms: resolveTerms(undefined, { guaranteeRateCut: 0.02 }),
  pools: [...propBase.pools, capped('t-loan'), capped('t-guar')],
  programmes: [
    ...propBase.programmes,
    {
      ...propBase.programmes[2],
      id: 't-loan',
      pool: 't-loan',
      instrument: { kind: 'loan', costShare, rate, requiredReturn: null }
    },
    {
      ...propBase.programmes[2],
      id: 't-guar',
      pool: 't-guar',
      instrument: { kind: 'guarantee', costShare, reserve }
    }
  ]
});

describe('the award rule is monotone (property)', () => {
  const proto = PROTOTYPES[0].id;
  it('lower money or a larger size never turns a failure into an award', () => {
    const rng = mulberry32(0x7a11);
    let nulls = 0;
    let awards = 0;
    for (let n = 0; n < 500; n++) {
      const fin = propFinance(0.05 + 0.9 * rng(), 0.1 * rng(), rng());
      const f = financeIndexOf(fin);
      const P = fin.programmes.length;
      const bundle = [...Array(P).keys()].filter(() => rng() < 0.7);
      const units = 1 + Math.floor(rng() * 200);
      // half the cases on a tenth of the money, so that every pool is often short (a null)
      const scale = rng() < 0.5 ? 2e7 : 2e8;
      const hi = fin.pools.map(() => (rng() < 0.2 ? 1e15 : Math.floor(rng() * scale)));
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

describe('adding a programme never turns an award into a wait (property)', () => {
  const proto = PROTOTYPES[0].id;
  const KINDS: PoolKind[] = [
    'goBond',
    'cop',
    'generalRevenue',
    'dedicatedTax',
    'state',
    'federal',
    'bank'
  ];
  it('500 random bundles, added programmes and balances: the award stands, its level not lower', () => {
    const rng = mulberry32(0xadd5);
    let awards = 0;
    let leftOut = 0;
    for (let n = 0; n < 500; n++) {
      const base = propFinance(0.05 + 0.9 * rng(), 0.1 * rng(), rng());
      const P = base.programmes.length;
      const bundle = [...Array(P).keys()].filter(() => rng() < 0.7);
      const kind = KINDS[Math.floor(rng() * KINDS.length)];
      const pick = rng();
      const instrument: Programme['instrument'] =
        pick < 1 / 3
          ? { kind: 'grant', share: 1 - rng() }
          : pick < 2 / 3
            ? {
                kind: 'loan',
                costShare: 0.05 + 0.9 * rng(),
                rate: 0.1 * rng(),
                requiredReturn: null
              }
            : { kind: 'guarantee', costShare: 0.05 + 0.9 * rng(), reserve: rng() };
      const fin: Finance = {
        ...base,
        pools: [
          ...base.pools,
          {
            id: 't-add',
            kind,
            label: 't-add',
            inflows: [],
            debt: kind === 'goBond' || kind === 'cop' ? { rate: 0.04, termYears: 30 } : null,
            leverage: 1
          }
        ],
        programmes: [
          ...base.programmes,
          { ...base.programmes[2], id: 't-add', pool: 't-add', reach: 'affordable', instrument }
        ]
      };
      const f = financeIndexOf(fin);
      const added = P;
      const units = 1 + Math.floor(rng() * 200);
      const bal = base.pools.map(() => (rng() < 0.2 ? 1e15 : Math.floor(rng() * 2e8)));
      const which = Math.floor(rng() * 3);
      bal.push(which === 0 ? 0 : which === 1 ? Math.floor(rng() * 2e8) : 1e15);
      const avail = (q: number) => bal[q];
      const without = awardSet(bundle, 'affordable', proto, units, avail, f);
      if (without === null) continue;
      awards++;
      const withP = awardSet([...bundle, added], 'affordable', proto, units, avail, f);
      expect(withP, 'case ' + n).not.toBeNull();
      expect(
        below(coverageLevel(withP!.priced.coverage), coverageLevel(without.priced.coverage)),
        'case ' + n
      ).toBe(false);
      if (!withP!.set.includes(added)) leftOut++;
    }
    // not vacuous: many awards, and many where the added pool was short and left out
    expect(awards).toBeGreaterThan(50);
    expect(leftOut).toBeGreaterThan(20);
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

describe('lineKey', () => {
  it('orders by keyDay, then rank, then market before affordable', () => {
    expect(lineKey(10, 5, 'affordable')).toBeLessThan(lineKey(11, 0, 'market'));
    expect(lineKey(10, 4, 'affordable')).toBeLessThan(lineKey(10, 5, 'market'));
    expect(lineKey(10, 5, 'market')).toBeLessThan(lineKey(10, 5, 'affordable'));
    expect(lineKey(P28 + 5, 3, 'market')).toBe(lineKey(P28, 3, 'market'));
    expect(lineKey(P28, P19 - 1, 'affordable')).toBe(P28 * P20 + (P19 - 1) * 2 + 1);
    expect(() => lineKey(10, P19, 'market')).toThrow(RangeError);
  });
});
