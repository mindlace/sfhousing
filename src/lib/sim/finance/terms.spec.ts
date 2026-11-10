import { describe, expect, it } from 'vitest';
import type { TermKey } from '../../timelapse/types';
import {
  AVERAGE_DRAWN,
  CONSTRUCTION_LOAN_TO_COST,
  DRAW_UP_FRONT,
  MARKET_TERMS,
  TYPED_TERM_RANGES,
  isResolvedTerms,
  resolveTerms
} from './terms';

const REASON =
  "No source gives the cut in a private construction loan's rate that a public guarantee earns. " +
  'The evidence search found no evaluation of any public loan guarantee or revolving fund ' +
  '(financing evidence digest, section 7), and no published spread between guaranteed and ' +
  'unguaranteed multifamily construction loans in San Francisco. A guarantee has no sourced ' +
  'grant-equivalent; it can be offered only with a rate cut the user types, labelled custom, ' +
  'not sourced.';

const KEYS: TermKey[] = [
  'constructionRate',
  'constructionYears',
  'requiredReturn',
  'guaranteeRateCut',
  'lossOnExit'
];

describe('MARKET_TERMS', () => {
  it('carries the section 4.3 values and tiers', () => {
    const t = MARKET_TERMS;
    expect(t.constructionRate.value).toBe(0.085);
    expect(t.constructionYears.value).toBe(1.917);
    expect(t.requiredReturn.value).toBe(0.06);
    expect(t.lossOnExit.value).toBe(1);
    for (const [k, tier] of [
      ['constructionRate', 3],
      ['constructionYears', 2],
      ['requiredReturn', 1]
    ] as const) {
      const e = t[k];
      expect('provenance' in e && e.provenance.tier).toBe(tier);
    }
    expect(t.lossOnExit.provenance.tier).toBe(4);
  });

  it('has guaranteeRateCut unsourced with the exact reason', () => {
    expect(MARKET_TERMS.guaranteeRateCut).toEqual({ value: null, reason: REASON });
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(MARKET_TERMS)).toBe(true);
    expect(Object.isFrozen(MARKET_TERMS.constructionRate)).toBe(true);
    const c = MARKET_TERMS.constructionRate;
    expect('provenance' in c && Object.isFrozen(c.provenance)).toBe(true);
  });
});

describe('draw schedule and loan-to-cost', () => {
  it('has the R11 draw constants', () => {
    expect(DRAW_UP_FRONT.value).toBe(0.1);
    expect(AVERAGE_DRAWN.value).toBeCloseTo(0.55, 12);
    for (const c of [DRAW_UP_FRONT, AVERAGE_DRAWN]) {
      expect(c.provenance.tier).toBe(4);
      expect(c.provenance.method).toContain("the partner's assumption, R11");
    }
  });

  it('has the 55 percent loan-to-cost', () => {
    expect(CONSTRUCTION_LOAN_TO_COST.value).toBe(0.55);
    expect(CONSTRUCTION_LOAN_TO_COST.provenance.tier).toBe(3);
  });
});

describe('resolveTerms', () => {
  it('resolves the market terms', () => {
    expect(resolveTerms()).toEqual({
      constructionRate: 0.085,
      constructionYears: 1.917,
      requiredReturn: 0.06,
      guaranteeRateCut: null,
      lossOnExit: 1,
      custom: []
    });
  });

  it('pins lossOnExit as the number 1', () => {
    expect(resolveTerms(MARKET_TERMS).lossOnExit).toBe(1);
  });

  it('takes a typed value for an unsourced term', () => {
    const r = resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01 });
    expect(r.guaranteeRateCut).toBe(0.01);
    expect(r.custom).toEqual(['guaranteeRateCut']);
  });

  it('lets a typed value replace a sourced one', () => {
    const r = resolveTerms(MARKET_TERMS, { constructionRate: 0.07 });
    expect(r.constructionRate).toBe(0.07);
    expect(r.custom).toEqual(['constructionRate']);
  });

  it('lists typed keys sorted, even when equal to the sourced value', () => {
    const r = resolveTerms(MARKET_TERMS, { requiredReturn: 0.06, constructionRate: 0.07 });
    expect(r.requiredReturn).toBe(0.06);
    expect(r.custom).toEqual(['constructionRate', 'requiredReturn']);
  });

  it('ignores unknown keys and undefined values', () => {
    const typed = { bogus: 3, constructionRate: undefined } as unknown as Partial<
      Record<TermKey, number>
    >;
    const r = resolveTerms(MARKET_TERMS, typed);
    expect(r).toEqual(resolveTerms());
    expect('bogus' in r).toBe(false);
  });

  it.each(KEYS)('range-checks %s', (key) => {
    const [lo, hi] = TYPED_TERM_RANGES[key];
    expect(resolveTerms(MARKET_TERMS, { [key]: lo })[key]).toBe(lo);
    expect(resolveTerms(MARKET_TERMS, { [key]: hi })[key]).toBe(hi);
    for (const v of [lo - 1e-9, hi + 1e-9, NaN]) {
      expect(() => resolveTerms(MARKET_TERMS, { [key]: v })).toThrow(RangeError);
      expect(() => resolveTerms(MARKET_TERMS, { [key]: v })).toThrow(
        `${key} must be between ${lo} and ${hi}; got ${v}`
      );
    }
  });

  it('has the section 4.3 ranges', () => {
    expect(TYPED_TERM_RANGES).toEqual({
      constructionRate: [0, 0.25],
      constructionYears: [0.25, 10],
      requiredReturn: [0.01, 0.25],
      guaranteeRateCut: [0, 0.05],
      lossOnExit: [0, 1]
    });
  });

  it('returns fresh objects each call', () => {
    const a = resolveTerms();
    const b = resolveTerms();
    expect(a).not.toBe(b);
    a.custom.push('lossOnExit');
    expect(resolveTerms().custom).toEqual([]);
    expect(b.custom).toEqual([]);
  });
});

describe('isResolvedTerms', () => {
  it('tells resolved from market terms', () => {
    expect(isResolvedTerms(resolveTerms())).toBe(true);
    expect(isResolvedTerms(MARKET_TERMS)).toBe(false);
  });
});
