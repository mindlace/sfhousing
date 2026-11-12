import { describe, expect, it } from 'vitest';
import { FIXTURE_AS_OF, fundingOnly, maxFunding } from './fixtures/finance';
import { FINANCE_LIMITS, FIRST_DAY, LAST_DAY, MAX_DOLLARS, parseFinanceLevers } from './finance';
import { LeverFormatError, type FinanceLevers } from './types';

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
