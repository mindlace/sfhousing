import { describe, expect, it } from 'vitest';
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
import { dayOf } from '$lib/sim/scenario/dates';
import { inflowArrivals } from '$lib/sim/scenario/funding';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day, Pool } from '$lib/timelapse/types';
import {
  FIXTURE_AS_OF,
  baselineFixture,
  fundingOnly,
  leapBaseline,
  maxFunding
} from './fixtures/finance';
import {
  FINANCE_LIMITS,
  FIRST_DAY,
  LAST_DAY,
  MAX_DOLLARS,
  buildFinance,
  parseFinanceLevers
} from './finance';
import { DEFAULT_LEVERS, LeverFormatError, type FinanceLevers } from './types';

const bad = (f: unknown): [string, string] | null => {
  try {
    parseFinanceLevers(f, 'finance');
  } catch (e) {
    if (e instanceof LeverFormatError) return [e.path, e.message.slice(e.path.length + 2)];
    throw e;
  }
  return null;
};
const ok = (f: unknown) => bad(f) === null;

const empty = (): FinanceLevers => ({ baselineScale: [], pools: [], programmes: [], terms: {} });
const base = (): FinanceLevers => fundingOnly();
const withScale = (...s: unknown[]) => ({ ...empty(), baselineScale: s });
const scale = (o: object = {}) => ({ pool: 'state', from: FIXTURE_AS_OF, scale: 1, ...o });
const pool = (o: object = {}) => ({ ...base().pools[0], ...o });
const withPools = (...p: unknown[]) => ({ ...empty(), pools: p });
const prog = (o: object = {}) => ({ ...base().programmes[0], ...o });
const withProg = (...p: unknown[]) => ({ ...base(), programmes: p });
const inst = (o: object) => prog({ instrument: o });

describe('constants', () => {
  it('are the spec values', () => {
    expect(FINANCE_LIMITS).toEqual({
      pools: 12,
      inflowsPerPool: 12,
      programmes: 24,
      baselineScale: 24,
      labelChars: 80,
      idChars: 40
    });
    expect([FIRST_DAY, LAST_DAY, MAX_DOLLARS]).toEqual([10957, 47482, 100_000_000_000]);
  });
});

describe('finance object', () => {
  it('parses empty and the fixtures, returning a fresh object', () => {
    const e = empty();
    expect(parseFinanceLevers(e, 'finance')).toEqual(e);
    expect(parseFinanceLevers(e, 'finance')).not.toBe(e);
    expect(parseFinanceLevers(base(), 'finance')).toEqual(base());
  });
  it('shape errors', () => {
    expect(bad(null)).toEqual(['finance', 'expected an object']);
    expect(bad({ ...empty(), extra: 1 })).toEqual(['finance.extra', 'unknown key']);
    expect(bad({ baselineScale: [], pools: [], programmes: [] })).toEqual([
      'finance.terms',
      'missing'
    ]);
  });
});

describe('baselineScale', () => {
  it('limit of 24', () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => scale({ from: FIXTURE_AS_OF + i }));
    expect(ok(withScale(...entries(24)))).toBe(true);
    expect(bad(withScale(...entries(25)))).toEqual([
      'finance.baselineScale',
      'expected at most 24 scale entries'
    ]);
  });
  it('entry keys', () => {
    expect(bad(withScale({ ...scale(), x: 1 }))).toEqual([
      'finance.baselineScale[0].x',
      'unknown key'
    ]);
  });
  it('pool', () => {
    expect(ok(withScale(scale()))).toBe(true);
    const m = 'expected a baseline pool id';
    expect(bad(withScale(scale({ pool: 'u-pool-1' })))).toEqual([
      'finance.baselineScale[0].pool',
      m
    ]);
    expect(bad(withScale(scale({ pool: 'Bad Id' })))).toEqual(['finance.baselineScale[0].pool', m]);
    expect(bad(withScale(scale({ pool: 3 })))).toEqual(['finance.baselineScale[0].pool', m]);
  });
  it('from', () => {
    const m = 'expected a whole day from 10957 to 47482';
    expect(ok(withScale(scale({ from: 10957 })))).toBe(true);
    expect(ok(withScale(scale({ from: 47482 })))).toBe(true);
    for (const from of [10956, 47483, 1.5])
      expect(bad(withScale(scale({ from })))).toEqual(['finance.baselineScale[0].from', m]);
  });
  it('scale', () => {
    const m = 'expected a number from 0 to 10';
    expect(ok(withScale(scale({ scale: 0 })))).toBe(true);
    expect(ok(withScale(scale({ scale: 10 })))).toBe(true);
    for (const s of [10.01, -0.1, Infinity, '1'])
      expect(bad(withScale(scale({ scale: s })))).toEqual(['finance.baselineScale[0].scale', m]);
  });
  it('order', () => {
    const m = 'expected entries sorted by pool, then by from, with no two on one day';
    expect(
      ok(
        withScale(
          scale({ pool: 'city-a' }),
          scale({ pool: 'state', from: 100 * 200 }),
          scale({ pool: 'state', from: 100 * 200 + 1 })
        )
      )
    ).toBe(true);
    expect(bad(withScale(scale({ pool: 'state' }), scale({ pool: 'city-a' })))).toEqual([
      'finance.baselineScale[1]',
      m
    ]);
    expect(bad(withScale(scale(), scale()))).toEqual(['finance.baselineScale[1]', m]);
    expect(bad(withScale(scale({ from: 12000 }), scale({ from: 11000 })))).toEqual([
      'finance.baselineScale[1]',
      m
    ]);
  });
});

describe('pools', () => {
  it('limit of 12', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => pool({ id: `u-pool-${i}` }));
    expect(ok(withPools(...many(12)))).toBe(true);
    expect(bad(withPools(...many(13)))).toEqual(['finance.pools', 'expected at most 12 pools']);
  });
  it('keys', () => {
    expect(bad(withPools({ ...pool(), x: 1 }))).toEqual(['finance.pools[0].x', 'unknown key']);
    const { debt: _d, ...rest } = pool();
    expect(bad(withPools(rest))).toEqual(['finance.pools[0].debt', 'missing']);
  });
  it('id', () => {
    expect(bad(withPools(pool({ id: 'pool-1' })))).toEqual([
      'finance.pools[0].id',
      'expected an id starting u-'
    ]);
    expect(bad(withPools(pool(), pool()))).toEqual(['finance.pools[1].id', 'duplicate id']);
  });
  it('a pool and a programme may share an id', () => {
    expect(ok({ ...base(), programmes: [prog({ id: 'u-pool-1' })] })).toBe(true);
  });
  it('label', () => {
    const m = 'expected a label of 1 to 80 characters';
    expect(bad(withPools(pool({ label: '   ' })))).toEqual(['finance.pools[0].label', m]);
    expect(bad(withPools(pool({ label: 'x'.repeat(81) })))).toEqual(['finance.pools[0].label', m]);
    expect(ok(withPools(pool({ label: 'x'.repeat(80) })))).toBe(true);
    expect(parseFinanceLevers(withPools(pool({ label: '  ok ' })), 'finance').pools[0].label).toBe(
      'ok'
    );
  });
  it('uncapped', () => {
    expect(bad(withPools(pool({ uncapped: true, inflows: [] })))).toEqual([
      'finance.pools[0].uncapped',
      'expected false: an added pool has a schedule of money'
    ]);
  });
  it('inflow count', () => {
    const m = 'expected 1 to 12 inflows';
    const one = { kind: 'once', day: FIXTURE_AS_OF, dollars: 5 };
    expect(bad(withPools(pool({ inflows: [] })))).toEqual(['finance.pools[0].inflows', m]);
    expect(bad(withPools(pool({ inflows: Array(13).fill(one) })))).toEqual([
      'finance.pools[0].inflows',
      m
    ]);
    expect(ok(withPools(pool({ inflows: Array(12).fill(one) })))).toBe(true);
  });
  it('bank leverage', () => {
    expect(ok(withPools(pool({ kind: 'bank', leverage: 10 })))).toBe(true);
    expect(bad(withPools(pool({ kind: 'bank', leverage: 10.5 })))).toEqual([
      'finance.pools[0].leverage',
      'expected a number above 0 and at most 10'
    ]);
  });
  it('inflow days and dollars', () => {
    const dm = 'expected a whole day from 10957 to 47482';
    const once = (o: object) =>
      withPools(pool({ inflows: [{ kind: 'once', day: 20000, dollars: 5, ...o }] }));
    const yr = (o: object) =>
      withPools(
        pool({ inflows: [{ kind: 'yearly', from: 20000, to: null, dollarsPerYear: 5, ...o }] })
      );
    expect(ok(once({ day: 10957 }))).toBe(true);
    expect(bad(once({ day: 10956 }))).toEqual(['finance.pools[0].inflows[0].day', dm]);
    expect(bad(once({ day: 47483 }))).toEqual(['finance.pools[0].inflows[0].day', dm]);
    expect(bad(yr({ from: 10956 }))).toEqual(['finance.pools[0].inflows[0].from', dm]);
    expect(bad(yr({ to: 47483 }))).toEqual(['finance.pools[0].inflows[0].to', dm]);
    expect(ok(yr({ to: 47482 }))).toBe(true);
    const dol = 'expected whole dollars from 1 to 100000000000';
    for (const dollars of [0, 1e11 + 1]) {
      expect(bad(once({ dollars }))).toEqual(['finance.pools[0].inflows[0].dollars', dol]);
      expect(bad(yr({ dollarsPerYear: dollars }))).toEqual([
        'finance.pools[0].inflows[0].dollarsPerYear',
        dol
      ]);
    }
    // A fractional amount fails checkPool's shared integer check first (spec 4.1: its message wins).
    expect(bad(once({ dollars: 1.5 }))).toEqual([
      'finance.pools[0].inflows[0].dollars',
      'expected an integer'
    ]);
    expect(ok(once({ dollars: 1e11 }))).toBe(true);
    expect(ok(once({ dollars: 1 }))).toBe(true);
  });
  it('shared rows carry checkPool messages at the lever path', () => {
    expect(bad(withPools(pool({ kind: 'goBond', debt: null })))).toEqual([
      'finance.pools[0].debt',
      'expected debt for kind goBond'
    ]);
    expect(bad(withPools(pool({ kind: 'bogus' })))).toEqual([
      'finance.pools[0].kind',
      'expected a pool kind, got bogus'
    ]);
    expect(bad(withPools(pool({ leverage: 2 })))).toEqual([
      'finance.pools[0].leverage',
      'expected 1 unless kind is bank, got 2'
    ]);
    expect(ok(withPools(pool({ kind: 'goBond', debt: { rate: 0.05, termYears: 20 } })))).toBe(true);
  });
});

describe('programmes', () => {
  it('limit of 24', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => prog({ id: `u-prog-${i}` }));
    expect(ok(withProg(...many(24)))).toBe(true);
    expect(bad(withProg(...many(25)))).toEqual([
      'finance.programmes',
      'expected at most 24 programmes'
    ]);
  });
  it('keys', () => {
    expect(bad(withProg({ ...prog(), x: 1 }))).toEqual(['finance.programmes[0].x', 'unknown key']);
    const { tiers: _t, ...rest } = prog();
    expect(bad(withProg(rest))).toEqual(['finance.programmes[0].tiers', 'missing']);
  });
  it('id and label', () => {
    expect(bad(withProg(prog({ id: 'prog-1' })))).toEqual([
      'finance.programmes[0].id',
      'expected an id starting u-'
    ]);
    expect(bad(withProg(prog(), prog()))).toEqual(['finance.programmes[1].id', 'duplicate id']);
    expect(bad(withProg(prog({ label: '' })))).toEqual([
      'finance.programmes[0].label',
      'expected a label of 1 to 80 characters'
    ]);
    expect(bad(withProg(prog({ label: 'x'.repeat(81) })))).toEqual([
      'finance.programmes[0].label',
      'expected a label of 1 to 80 characters'
    ]);
    expect(
      parseFinanceLevers(withProg(prog({ label: ' hi ' })), 'finance').programmes[0].label
    ).toBe('hi');
  });
  it('pool', () => {
    expect(ok(withProg(prog({ pool: 'state' })))).toBe(true);
    expect(bad(withProg(prog({ pool: 'u-missing' })))).toEqual([
      'finance.programmes[0].pool',
      'expected the id of an added pool'
    ]);
    expect(bad(withProg(prog({ pool: 'Bad' })))).toEqual([
      'finance.programmes[0].pool',
      'expected a pool id'
    ]);
  });
  it('reach', () => {
    expect(bad(withProg(prog({ reach: 'both' })))).toEqual([
      'finance.programmes[0].reach',
      'expected one of market, affordable'
    ]);
  });
  it('instrument', () => {
    const m = 'expected one of grant, loan, guarantee';
    expect(bad(withProg(inst({ kind: 'gift', share: 1 })))).toEqual([
      'finance.programmes[0].instrument.kind',
      m
    ]);
    expect(bad(withProg(inst({ kind: 'grant', share: 0.5, extra: 1 })))).toEqual([
      'finance.programmes[0].instrument.extra',
      'unknown key'
    ]);
    expect(bad(withProg(inst({ kind: 'grant', share: 0 })))).toEqual([
      'finance.programmes[0].instrument',
      'A grant pays more than 0% and at most 100% of the uncovered cost.'
    ]);
    expect(
      bad(withProg(inst({ kind: 'loan', costShare: 0.5, rate: 0.3, requiredReturn: null })))
    ).toEqual(['finance.programmes[0].instrument', "A loan's rate is between 0% and 25%."]);
    expect(
      ok(withProg(inst({ kind: 'loan', costShare: 0.5, rate: 0.03, requiredReturn: null })))
    ).toBe(true);
    expect(ok(withProg(inst({ kind: 'guarantee', costShare: 0.5, reserve: 0.1 })))).toBe(true);
  });
  it('from and to', () => {
    const m = 'expected null or a day on or after from';
    expect(bad(withProg(prog({ from: 20000, to: 19999 })))).toEqual([
      'finance.programmes[0].to',
      m
    ]);
    expect(ok(withProg(prog({ from: 20000, to: 20000 })))).toBe(true);
    expect(bad(withProg(prog({ to: 'x' })))).toEqual(['finance.programmes[0].to', m]);
    expect(bad(withProg(prog({ from: 10956 })))).toEqual([
      'finance.programmes[0].from',
      'expected a whole day from 10957 to 47482'
    ]);
  });
  it('minHomes', () => {
    const m = 'expected a whole number from 0 to 10000';
    for (const minHomes of [-1, 10001, 2.5])
      expect(bad(withProg(prog({ minHomes })))).toEqual(['finance.programmes[0].minHomes', m]);
    expect(ok(withProg(prog({ minHomes: 0 })))).toBe(true);
    expect(ok(withProg(prog({ minHomes: 10000 })))).toBe(true);
  });
  it('tiers', () => {
    const m = 'expected tiers for affordable reach only';
    expect(bad(withProg(prog({ tiers: null })))).toEqual(['finance.programmes[0].tiers', m]);
    expect(bad(withProg(prog({ reach: 'market' })))).toEqual(['finance.programmes[0].tiers', m]);
    expect(ok(withProg(prog({ reach: 'market', tiers: null })))).toBe(true);
    expect(
      bad(withProg(prog({ tiers: { veryLow: 0.5, low: 0.4, moderate: 0, aboveModerate: 0 } })))
    ).toEqual(['finance.programmes[0].tiers', 'expected values summing to 1, got 0.9']);
    expect(
      bad(withProg(prog({ tiers: { veryLow: 1, low: 0, moderate: 0, aboveModerate: 0, x: 0 } })))
    ).toEqual(['finance.programmes[0].tiers.x', 'unknown key']);
    expect(
      bad(withProg(prog({ tiers: { veryLow: -0.5, low: 1.5, moderate: 0, aboveModerate: 0 } })))
    ).toEqual(['finance.programmes[0].tiers.veryLow', 'expected a number of 0 or more']);
  });
});

describe('terms', () => {
  const t = (terms: unknown) => ({ ...empty(), terms });
  it('shape', () => {
    expect(bad(t(null))).toEqual(['finance.terms', 'expected an object']);
    expect(bad(t({ nope: 1 }))).toEqual(['finance.terms.nope', 'unknown key']);
    expect(bad(t({ lossOnExit: '1' }))).toEqual(['finance.terms.lossOnExit', 'expected a number']);
    expect(bad(t({ lossOnExit: NaN }))).toEqual(['finance.terms.lossOnExit', 'expected a number']);
    expect(ok(t({}))).toBe(true);
  });
  const ranges = {
    constructionRate: [0, 0.25],
    constructionYears: [0.25, 10],
    requiredReturn: [0.01, 0.25],
    guaranteeRateCut: [0, 0.05],
    lossOnExit: [0, 1]
  } as const;
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    it(`${key} at and outside its range`, () => {
      expect(ok(t({ [key]: lo }))).toBe(true);
      expect(ok(t({ [key]: hi }))).toBe(true);
      const above = hi + 0.01;
      expect(bad(t({ [key]: above }))).toEqual([
        `finance.terms.${key}`,
        `${key} must be between ${lo} and ${hi}; got ${above}`
      ]);
      const below = lo - 0.01;
      expect(bad(t({ [key]: below }))).toEqual([
        `finance.terms.${key}`,
        `${key} must be between ${lo} and ${hi}; got ${below}`
      ]);
    });
  }
  it('lossOnExit 1.01', () => {
    expect(bad(t({ lossOnExit: 1.01 }))).toEqual([
      'finance.terms.lossOnExit',
      'lossOnExit must be between 0 and 1; got 1.01'
    ]);
  });
  it('a guarantee with no typed guaranteeRateCut parses', () => {
    const f = withProg(inst({ kind: 'guarantee', costShare: 0.5, reserve: 0.1 }));
    expect(parseFinanceLevers(f, 'finance').terms).toEqual({});
  });
});

describe('maxFunding', () => {
  it('parses and is under 32 KiB', () => {
    const m = maxFunding();
    expect(parseFinanceLevers(m, 'finance')).toEqual(m);
    expect(JSON.stringify(m).length).toBeLessThan(32768);
  });
});

// ---------------------------------------------------------------------------------------------
// buildFinance (spec 2026-11-09 section 4.4)

type Fin = NonNullable<SimInput['finance']>;
const A = FIXTURE_AS_OF;
const fixture = (): Fin => baselineFixture().finance;
const levers = (o: Partial<FinanceLevers> = {}): FinanceLevers => ({ ...empty(), ...o });
const scales = (...s: FinanceLevers['baselineScale']) => levers({ baselineScale: s });
const poolOf = (f: Fin, id: string) => f.pools.find((p) => p.id === id)!;
const fails = (fn: () => unknown): [string, string] | null => {
  try {
    fn();
  } catch (e) {
    if (e instanceof LeverFormatError) return [e.path, e.message.slice(e.path.length + 2)];
    throw e;
  }
  return null;
};

/** day → dollars received from a pool, expanded with the engine's own arrival rule. */
function received(p: Pool, asOf: Day = A): Map<Day, number> {
  const out = new Map<Day, number>();
  for (const inflow of p.inflows) {
    const dollars = inflow.kind === 'once' ? inflow.dollars : inflow.dollarsPerYear;
    for (const d of inflowArrivals(inflow, asOf, LAST_DAY)) out.set(d, (out.get(d) ?? 0) + dollars);
  }
  return out;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('buildFinance: identity and no baseline', () => {
  it('empty levers return base by identity', () => {
    const base = fixture();
    expect(buildFinance(base, empty(), A)).toBe(base);
    expect(buildFinance(base, DEFAULT_LEVERS.finance, A)).toBe(base);
  });

  it('base undefined returns undefined for empty and for non-empty levers', () => {
    expect(buildFinance(undefined, empty(), A)).toBeUndefined();
    expect(buildFinance(undefined, fundingOnly(), A)).toBeUndefined();
    expect(buildFinance(undefined, maxFunding(), A)).toBeUndefined();
  });

  it('a terms-only lever gives a new object naming the term, with the base pools', () => {
    const base = fixture();
    const out = buildFinance(base, levers({ terms: { lossOnExit: 0.5 } }), A)!;
    expect(out).not.toBe(base);
    expect(out.terms.custom).toEqual(['lossOnExit']);
    expect(out.terms).toEqual(resolveTerms(MARKET_TERMS, { lossOnExit: 0.5 }));
    expect(out.pools).toHaveLength(base.pools.length);
    base.pools.forEach((p, i) => expect(out.pools[i]).toBe(p));
    base.programmes.forEach((g, i) => expect(out.programmes[i]).toBe(g));
    expect(out.off).toEqual([]);
    expect(out.slope).toBe(base.slope);
  });
});

describe('buildFinance: id check against the baseline', () => {
  it('a scale entry naming no baseline pool', () => {
    const f = scales({ pool: 'nope', from: A, scale: 1 });
    expect(fails(() => buildFinance(fixture(), f, A))).toEqual([
      'finance.baselineScale[0].pool',
      'no baseline pool nope in this data'
    ]);
  });

  it('a programme naming no baseline pool', () => {
    const f = levers({ programmes: [{ ...fundingOnly().programmes[0], pool: 'nope' }] });
    expect(fails(() => buildFinance(fixture(), f, A))).toEqual([
      'finance.programmes[0].pool',
      'no baseline pool nope in this data'
    ]);
  });

  it('scale entries are checked before programmes', () => {
    const f = levers({
      baselineScale: [{ pool: 'gone', from: A, scale: 1 }],
      programmes: [{ ...fundingOnly().programmes[0], pool: 'nope' }]
    });
    expect(fails(() => buildFinance(fixture(), f, A))?.[0]).toBe('finance.baselineScale[0].pool');
  });

  it('an added programme on a baseline pool compiles, copied as written', () => {
    const prog = { ...fundingOnly().programmes[0], pool: 'state' };
    const out = buildFinance(fixture(), levers({ programmes: [prog] }), A)!;
    expect(out.programmes.at(-1)).toEqual(prog);
  });
});

describe('buildFinance: terms', () => {
  const guarantee = (): FinanceLevers => {
    const f = fundingOnly();
    f.baselineScale = [];
    f.programmes[0].instrument = { kind: 'guarantee', costShare: 0.5, reserve: 0.1 };
    return f;
  };

  it('a guarantee with no typed cut throws at its instrument', () => {
    expect(fails(() => buildFinance(fixture(), guarantee(), A))).toEqual([
      'finance.programmes[0].instrument',
      'guarantee needs guaranteeRateCut, which is not sourced'
    ]);
  });

  it('the same guarantee with the cut typed compiles', () => {
    const f = { ...guarantee(), terms: { guaranteeRateCut: 0.01 } };
    const out = buildFinance(fixture(), f, A)!;
    expect(out.terms.guaranteeRateCut).toBe(0.01);
    expect(out.terms.custom).toEqual(['guaranteeRateCut']);
    expect(out.programmes.at(-1)!.instrument.kind).toBe('guarantee');
  });

  it('plan terms are resolveTerms(MARKET_TERMS, levers.terms)', () => {
    const t = { constructionRate: 0.07, lossOnExit: 0.2 };
    expect(buildFinance(fixture(), levers({ terms: t }), A)!.terms).toEqual(
      resolveTerms(MARKET_TERMS, t)
    );
  });
});

describe('buildFinance: scaling a capped pool', () => {
  const Y27 = dayOf(2027, 1, 1);
  const Y28 = dayOf(2028, 1, 1);
  const Y29 = dayOf(2029, 1, 1);

  it('scale 0.5, 0 and 10 from mid-run on yearly and once inflows', () => {
    const base = fixture();
    poolOf(base, 'city-b').inflows.push(
      { kind: 'once', day: dayOf(2027, 6, 1), dollars: 1_000_001 },
      { kind: 'once', day: dayOf(2028, 6, 1), dollars: 7 },
      { kind: 'once', day: dayOf(2029, 6, 1), dollars: 3 }
    );
    const f = scales(
      { pool: 'city-b', from: Y27, scale: 0.5 },
      { pool: 'city-b', from: Y28, scale: 0 },
      { pool: 'city-b', from: Y29, scale: 10 }
    );
    const out = buildFinance(base, f, A)!;
    expect(poolOf(out, 'city-b').inflows).toEqual([
      { kind: 'once', day: A, dollars: 4_000_000 },
      { kind: 'once', day: dayOf(2027, 3, 15), dollars: 2_000_000 },
      { kind: 'once', day: dayOf(2027, 6, 1), dollars: 500_001 },
      { kind: 'yearly', from: dayOf(2029, 3, 15), to: null, dollarsPerYear: 40_000_000 },
      { kind: 'once', day: dayOf(2029, 6, 1), dollars: 30 }
    ]);
    expect(out.off).toEqual([{ pool: 'city-b', from: Y28, to: Y29 - 1 }]);
    // the other fields of the pool are the base's
    const { inflows: _a, ...rest } = poolOf(out, 'city-b');
    const { inflows: _b, ...baseRest } = poolOf(base, 'city-b');
    expect(rest).toEqual(baseRest);
  });

  it('a yearly inflow with an end keeps it in the open run', () => {
    const base = fixture();
    poolOf(base, 'state').inflows[0] = {
      kind: 'yearly',
      from: A,
      to: dayOf(2031, 3, 15),
      dollarsPerYear: 3_000_000
    };
    const out = buildFinance(base, scales({ pool: 'state', from: Y28, scale: 2 }), A)!;
    expect(poolOf(out, 'state').inflows).toEqual([
      { kind: 'once', day: A, dollars: 3_000_000 },
      { kind: 'once', day: dayOf(2027, 3, 15), dollars: 3_000_000 },
      { kind: 'yearly', from: dayOf(2028, 3, 15), to: dayOf(2031, 3, 15), dollarsPerYear: 6e6 }
    ]);
  });

  it('amounts are rounded with Math.round and zero amounts dropped', () => {
    const base = fixture();
    poolOf(base, 'city-b').inflows.push({ kind: 'once', day: A + 10, dollars: 1 });
    poolOf(base, 'state').inflows[0] = {
      kind: 'yearly',
      from: A,
      to: null,
      dollarsPerYear: 3_000_001
    };
    const out = buildFinance(
      base,
      scales({ pool: 'city-b', from: A, scale: 0.1 }, { pool: 'state', from: A, scale: 0.5 }),
      A
    )!;
    expect(poolOf(out, 'city-b').inflows).toEqual([
      { kind: 'yearly', from: A, to: null, dollarsPerYear: 400_000 }
    ]);
    expect(poolOf(out, 'state').inflows).toEqual([
      { kind: 'yearly', from: A, to: null, dollarsPerYear: Math.round(3_000_001 * 0.5) }
    ]);
    expect(out.off).toEqual([]);
  });

  it('the latest entry at or before each arrival applies', () => {
    const f = scales(
      { pool: 'state', from: A + 100, scale: 2 },
      { pool: 'state', from: A + 500, scale: 3 }
    );
    const out = buildFinance(fixture(), f, A)!;
    expect(poolOf(out, 'state').inflows).toEqual([
      { kind: 'once', day: A, dollars: 3_000_000 },
      { kind: 'once', day: dayOf(2027, 3, 15), dollars: 6_000_000 },
      { kind: 'yearly', from: dayOf(2028, 3, 15), to: null, dollarsPerYear: 9_000_000 }
    ]);
  });

  it('every received arrival is an original arrival at round(dollars × scaleAt(day))', () => {
    const base = fixture();
    poolOf(base, 'city-b').inflows.push({ kind: 'once', day: dayOf(2030, 7, 4), dollars: 999 });
    const entries = [
      { pool: 'city-b', from: A - 400, scale: 1.25 },
      { pool: 'city-b', from: dayOf(2027, 3, 15), scale: 0 },
      { pool: 'city-b', from: dayOf(2027, 3, 16), scale: 0.3 },
      { pool: 'city-b', from: dayOf(2030, 1, 1), scale: 7 }
    ];
    const scaleAt = (d: Day) => entries.filter((e) => e.from <= d).at(-1)?.scale ?? 1;
    const out = buildFinance(base, scales(...entries), A)!;
    const want = new Map<Day, number>();
    for (const [d, x] of received(poolOf(base, 'city-b'))) {
      const v = Math.round(x * scaleAt(d));
      if (v > 0) want.set(d, v);
    }
    expect(received(poolOf(out, 'city-b'))).toEqual(want);
  });
});

describe('buildFinance: off spans', () => {
  const X = A + 200;
  const Y = dayOf(2030, 3, 15);

  it('scale 0 then 1 on a capped pool: one off span, no arrival inside it', () => {
    const base = fixture();
    const f = scales({ pool: 'state', from: X, scale: 0 }, { pool: 'state', from: Y, scale: 1 });
    const out = buildFinance(base, f, A)!;
    expect(out.off).toEqual([{ pool: 'state', from: X, to: Y - 1 }]);
    const state = poolOf(out, 'state');
    const days = state.inflows.flatMap((i) => inflowArrivals(i, FIXTURE_AS_OF, LAST_DAY));
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) expect(d < X || d >= Y).toBe(true);
    for (const i of state.inflows)
      expect(i.kind === 'once' ? i.dollars : i.dollarsPerYear).toBeGreaterThan(0);
    expect(days).toContain(A);
    expect(days).toContain(Y);
    expect(out.programmes.map((g) => g.id)).toEqual(base.programmes.map((g) => g.id));
    expect(out.programmes.map((g) => g.id)).toContain('baseline-state');
  });

  it('two consecutive zero entries give one span', () => {
    const f = scales(
      { pool: 'state', from: X, scale: 0 },
      { pool: 'state', from: X + 100, scale: 0 },
      { pool: 'state', from: Y, scale: 1 }
    );
    expect(buildFinance(fixture(), f, A)!.off).toEqual([{ pool: 'state', from: X, to: Y - 1 }]);
  });

  it('scale 0 to the end gives to: null', () => {
    const out = buildFinance(fixture(), scales({ pool: 'state', from: X, scale: 0 }), A)!;
    expect(out.off).toEqual([{ pool: 'state', from: X, to: null }]);
    expect(poolOf(out, 'state').inflows).toEqual([{ kind: 'once', day: A, dollars: 3_000_000 }]);
  });

  it('scale 0 on the uncapped federal pool', () => {
    const base = fixture();
    const out = buildFinance(base, scales({ pool: 'federal', from: X, scale: 0 }), A)!;
    expect(out.off).toEqual([{ pool: 'federal', from: X, to: null }]);
    expect(poolOf(out, 'federal')).toBe(poolOf(base, 'federal'));
    const g = out.programmes.find((p) => p.pool === 'federal')!;
    expect(g.id).toBe('baseline-federal');
    expect(out.programmes.map((p) => p.id)).toEqual(base.programmes.map((p) => p.id));
  });

  it('scale 2 on federal gives no span and no change', () => {
    const base = fixture();
    const out = buildFinance(base, scales({ pool: 'federal', from: X, scale: 2 }), A)!;
    expect(out.off).toEqual([]);
    base.pools.forEach((p, i) => expect(out.pools[i]).toBe(p));
    expect(out.programmes).toEqual(base.programmes);
  });

  it('scale-before-asOf-then-later', () => {
    const f = scales(
      { pool: 'city-b', from: FIXTURE_AS_OF - 30, scale: 0 },
      { pool: 'city-b', from: FIXTURE_AS_OF + 400, scale: 0.5 }
    );
    const out = buildFinance(fixture(), f, A)!;
    expect(out.off).toEqual([
      { pool: 'city-b', from: FIXTURE_AS_OF - 30, to: FIXTURE_AS_OF + 399 }
    ]);
    const got = [...received(poolOf(out, 'city-b'))].sort((a, b) => a[0] - b[0]);
    expect(got[0][0]).toBeGreaterThanOrEqual(FIXTURE_AS_OF + 400);
    expect(got[0][1]).toBe(Math.round(4_000_000 * 0.5));
  });

  it('a scale of 0.5 dated before asOf scales the first arrival on or after asOf', () => {
    const out = buildFinance(fixture(), scales({ pool: 'state', from: A - 10, scale: 0.5 }), A)!;
    expect(poolOf(out, 'state').inflows).toEqual([
      { kind: 'yearly', from: A, to: null, dollarsPerYear: 1_500_000 }
    ]);
    expect(out.off).toEqual([]);
  });
});

describe('buildFinance: dates and leap years', () => {
  it('leap: arrival days on city-a equal inflowArrivals on the original inflow', () => {
    const base = leapBaseline().finance;
    const original = poolOf(base, 'city-a').inflows[0];
    const out = buildFinance(
      base,
      scales({ pool: 'city-a', from: dayOf(2029, 1, 1), scale: 1 }),
      A
    )!;
    const want = inflowArrivals(original, A, LAST_DAY);
    const got = poolOf(out, 'city-a')
      .inflows.flatMap((i) => inflowArrivals(i, A, LAST_DAY))
      .sort((a, b) => a - b);
    expect(got).toEqual(want);
    expect(got).toContain(dayOf(2032, 2, 29));
    expect(got).toContain(dayOf(2031, 2, 28));
    const yearly = poolOf(out, 'city-a').inflows.find((i) => i.kind === 'yearly');
    expect(yearly).toEqual({
      kind: 'yearly',
      from: dayOf(2032, 2, 29),
      to: null,
      dollarsPerYear: 6_000_000
    });
  });

  it('a once added inflow before asOf is passed as written', () => {
    const f = fundingOnly();
    f.baselineScale = [];
    f.pools[0].inflows = [{ kind: 'once', day: A - 50, dollars: 1_000_000 }];
    const out = buildFinance(fixture(), f, A)!;
    expect(poolOf(out, 'u-pool-1')).toEqual(f.pools[0]);
  });
});

describe('buildFinance: order and purity', () => {
  it('pools, programmes and spans in order', () => {
    const base = fixture();
    base.off = [{ pool: 'city-a', from: A + 1, to: A + 2 }];
    const f = fundingOnly();
    f.baselineScale = [
      { pool: 'city-b', from: A + 10, scale: 0 },
      { pool: 'city-b', from: A + 20, scale: 1 },
      { pool: 'city-b', from: A + 30, scale: 0 },
      { pool: 'federal', from: A + 5, scale: 0 },
      { pool: 'state', from: A + 1, scale: 0 }
    ];
    f.programmes.push({ ...f.programmes[0], id: 'u-prog-2', pool: 'city-a' });
    const out = buildFinance(base, f, A)!;
    expect(out.pools.map((p) => p.id)).toEqual([
      'city-a',
      'city-b',
      'state',
      'federal',
      'u-pool-1'
    ]);
    expect(out.programmes.map((p) => p.id)).toEqual([
      'baseline-city-a',
      'baseline-city-b',
      'baseline-state',
      'baseline-federal',
      'u-prog-1',
      'u-prog-2'
    ]);
    expect(out.off).toEqual([
      { pool: 'city-a', from: A + 1, to: A + 2 },
      { pool: 'city-b', from: A + 10, to: A + 19 },
      { pool: 'city-b', from: A + 30, to: null },
      { pool: 'state', from: A + 1, to: null },
      { pool: 'federal', from: A + 5, to: null }
    ]);
  });

  it('a deep-frozen base is not mutated', () => {
    const base = deepFreeze(fixture());
    const before = structuredClone(base);
    const f = deepFreeze(maxFunding());
    f.baselineScale.forEach((e) => expect(e.pool).not.toMatch(/^u-/));
    const out = buildFinance(base, f, A)!;
    expect(base).toEqual(before);
    expect(out).not.toBe(base);
    const zero = deepFreeze(
      scales({ pool: 'state', from: A + 200, scale: 0 }, { pool: 'federal', from: A, scale: 0 })
    );
    expect(() => buildFinance(base, zero, A)).not.toThrow();
    expect(base).toEqual(before);
  });
});
