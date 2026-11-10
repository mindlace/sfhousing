import { describe, expect, it } from 'vitest';
import type { Instrument } from '../../timelapse/types';
import {
  CERTAIN_TOLERANCE,
  INSTRUMENT_BOUNDS,
  coverage,
  grantEquivalentPerHome,
  isCertain,
  missingTerms,
  oddsShift,
  projectDollars,
  termsNeeded,
  validateInstrument
} from './instruments';
import { MARKET_TERMS } from './terms';
import { B, SLOPE_FIXTURE, TERMS, TERMS_CUT } from './test/fixtures';
import { AFFORDABLE } from './prototypes';

const GRANT_MSG = 'A grant pays more than 0% and at most 100% of the uncovered cost.';
const COST_MSG = 'A loan or guarantee covers more than 0% and at most 100% of the cost.';
const RATE_MSG = "A loan's rate is between 0% and 25%.";
const RETURN_MSG = 'The return the lent money accepts is between 1% and 25%.';
const RESERVE_MSG = "A guarantee's reserve is between 0% and 100% of the loan.";

const loan = (costShare: number, rate: number, requiredReturn: number | null): Instrument => ({
  kind: 'loan',
  costShare,
  rate,
  requiredReturn
});

describe('grantEquivalentPerHome worked values', () => {
  it('prices a grant at share x U', () => {
    const g: Instrument = { kind: 'grant', share: 50000 / 217000 };
    expect(grantEquivalentPerHome(g, 'market', B, TERMS)).toBe(50000);
    expect(50000 / 736700).toBeCloseTo(0.068, 3);
  });
  it('prices the return-only loan', () => {
    expect(grantEquivalentPerHome(loan(1, 0.085, 0.0525), 'market', B, TERMS)).toBe(83529);
  });
  it('prices the 60% loan at 4%', () => {
    expect(grantEquivalentPerHome(loan(0.6, 0.04, null), 'market', B, TERMS)).toBe(20972);
  });
  it('gives the same result for MARKET_TERMS and resolved terms', () => {
    for (const i of [{ kind: 'grant', share: 0.2 } as Instrument, loan(0.6, 0.04, 0.05)]) {
      expect(grantEquivalentPerHome(i, 'market', B, MARKET_TERMS)).toBe(
        grantEquivalentPerHome(i, 'market', B, TERMS)
      );
    }
  });
  it('is 0 for a loan at or above the market rate and return', () => {
    expect(grantEquivalentPerHome(loan(1, 0.09, 0.07), 'market', B, TERMS)).toBe(0);
  });
  it('caps a loan at its principal', () => {
    expect(grantEquivalentPerHome(loan(1, 0.085, 0.02), 'market', B, TERMS)).toBe(736700);
  });
  it('uses V = 92602 for affordable', () => {
    expect(AFFORDABLE.value.ownPerHome).toBe(92602);
    expect(grantEquivalentPerHome(loan(1, 0.085, 0.0525), 'affordable', B, TERMS)).toBe(
      Math.round(92602 * (0.06 / 0.0525 - 1))
    );
  });
  it('throws for a guarantee without a rate cut, prices it with one', () => {
    const g: Instrument = { kind: 'guarantee', costShare: 0.6, reserve: 0.1 };
    expect(() => grantEquivalentPerHome(g, 'market', B, TERMS)).toThrow(
      'guarantee needs guaranteeRateCut, which is not sourced'
    );
    expect(grantEquivalentPerHome(g, 'market', B, TERMS_CUT)).toBe(4660);
  });
  it('throws RangeError with the validation text for an invalid instrument', () => {
    const bad: Instrument = { kind: 'grant', share: 2 };
    expect(() => grantEquivalentPerHome(bad, 'market', B, TERMS)).toThrow(RangeError);
    expect(() => grantEquivalentPerHome(bad, 'market', B, TERMS)).toThrow(GRANT_MSG);
  });
});

describe('oddsShift and coverage', () => {
  it('matches the design example', () => {
    const s = oddsShift(50000, 'market', B, SLOPE_FIXTURE);
    expect(s).toBeCloseTo(0.1187729, 7);
    expect(Math.exp(s)).toBeCloseTo(1.1261, 4);
    expect(oddsShift(0, 'market', B, SLOPE_FIXTURE)).toBe(0);
  });
  it('throws for negative or non-finite grant-equivalents', () => {
    for (const g of [-1, NaN]) {
      const msg = `grant-equivalent must be a finite number of 0 or more; got ${g}`;
      expect(() => coverage(g, 'market', B)).toThrow(msg);
      expect(() => oddsShift(g, 'market', B, SLOPE_FIXTURE)).toThrow(msg);
    }
  });
  it('computes coverage unrounded', () => {
    expect(coverage(217000, 'market', B)).toBe(1);
  });
});

describe('isCertain', () => {
  it('uses the tolerance', () => {
    expect(CERTAIN_TOLERANCE).toBe(1e-9);
    expect(isCertain(1 - 1e-12)).toBe(true);
    expect(isCertain(0.999)).toBe(false);
  });
});

describe('termsNeeded and missingTerms', () => {
  it('lists the terms each instrument reads', () => {
    expect(termsNeeded({ kind: 'grant', share: 1 })).toEqual([]);
    expect(termsNeeded(loan(1, 0.04, null))).toEqual(['constructionRate', 'constructionYears']);
    expect(termsNeeded(loan(1, 0.04, 0.05))).toEqual([
      'constructionRate',
      'constructionYears',
      'requiredReturn'
    ]);
    expect(termsNeeded({ kind: 'guarantee', costShare: 1, reserve: 0 })).toEqual([
      'constructionYears',
      'guaranteeRateCut'
    ]);
  });
  it('reports the null ones', () => {
    const g: Instrument = { kind: 'guarantee', costShare: 1, reserve: 0 };
    expect(missingTerms(g, TERMS)).toEqual(['guaranteeRateCut']);
    expect(missingTerms(g, TERMS_CUT)).toEqual([]);
    expect(missingTerms(g, MARKET_TERMS)).toEqual(['guaranteeRateCut']);
    expect(missingTerms(loan(1, 0.04, 0.05), TERMS)).toEqual([]);
  });
});

describe('validateInstrument', () => {
  const g = (share: number): Instrument => ({ kind: 'grant', share });
  const gu = (costShare: number, reserve: number): Instrument => ({
    kind: 'guarantee',
    costShare,
    reserve
  });
  it('checks grant share', () => {
    for (const s of [0, 1.0001, NaN]) expect(validateInstrument(g(s))).toBe(GRANT_MSG);
  });
  it('checks costShare for loans and guarantees', () => {
    for (const s of [0, 1.0001, NaN]) {
      expect(validateInstrument(loan(s, 0.04, null))).toBe(COST_MSG);
      expect(validateInstrument(gu(s, 0.1))).toBe(COST_MSG);
    }
  });
  it('checks rate', () => {
    for (const r of [-0.0001, 0.2501, NaN]) {
      expect(validateInstrument(loan(1, r, null))).toBe(RATE_MSG);
    }
  });
  it('checks requiredReturn', () => {
    for (const r of [0.0099, 0.2501, 0, NaN]) {
      expect(validateInstrument(loan(1, 0.04, r))).toBe(RETURN_MSG);
    }
  });
  it('checks reserve', () => {
    for (const r of [-0.01, 1.01, NaN]) expect(validateInstrument(gu(1, r))).toBe(RESERVE_MSG);
  });
  it('rejects an unknown kind', () => {
    expect(validateInstrument({ kind: 'swap' } as unknown as Instrument)).toBe(
      'Unknown instrument kind.'
    );
  });
  it('accepts valid instruments at full precision', () => {
    expect(validateInstrument(g(0.348251))).toBeNull();
    expect(validateInstrument(g(1))).toBeNull();
    expect(validateInstrument(loan(1, 0, null))).toBeNull();
    expect(validateInstrument(loan(1, 0.25, 0.01))).toBeNull();
    expect(validateInstrument(loan(1, 0.04, 0.25))).toBeNull();
    expect(validateInstrument(gu(1, 0))).toBeNull();
    expect(validateInstrument(gu(1, 1))).toBeNull();
  });
  it('exports the one set of bounds', () => {
    expect(INSTRUMENT_BOUNDS).toEqual({
      share: { gt: 0, max: 1 },
      costShare: { gt: 0, max: 1 },
      rate: { min: 0, max: 0.25 },
      requiredReturn: { min: 0.01, max: 0.25 },
      reserve: { min: 0, max: 1 }
    });
  });
});

describe('projectDollars', () => {
  it('rounds once', () => {
    expect(projectDollars(300027, 130)).toBe(39003510);
    expect(projectDollars(0.5, 1)).toBe(1);
  });
});
