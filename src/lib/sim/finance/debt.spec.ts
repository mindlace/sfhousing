import { describe, expect, it } from 'vitest';
import { DEBT_BOUNDS, DEBT_LIMITS, debtService, limitStatements, validateDebt } from './debt';

const RATE_MSG = 'A borrowing rate is above 0% and at most 25%.';
const TERM_MSG = 'A borrowing term is a whole number of years from 1 to 40.';
const M = 1e6;
const go = (principal: number) => ({
  pool: 'g',
  kind: 'goBond' as const,
  principal,
  debt: { rate: 0.06, termYears: 20 }
});
const cop = (principal: number) => ({
  pool: 'c',
  kind: 'cop' as const,
  principal,
  debt: { rate: 0.065, termYears: 20 }
});

describe('debtService', () => {
  it('reproduces Budget Analyst Exhibits 40 and 42', () => {
    expect(debtService(410442573, { rate: 0.06, termYears: 20 })).toEqual({
      annual: 35784254,
      total: 715685078
    });
    expect(debtService(1668752923, { rate: 0.065, termYears: 20 }).annual).toBe(151450000);
  });
  it('is zero for zero principal', () => {
    expect(debtService(0, { rate: 0.06, termYears: 20 })).toEqual({ annual: 0, total: 0 });
  });
  it('throws RangeError for invalid debt or principal', () => {
    for (const debt of [
      { rate: 0, termYears: 20 },
      { rate: 0.2501, termYears: 20 },
      { rate: NaN, termYears: 20 },
      { rate: 0.06, termYears: 0 },
      { rate: 0.06, termYears: 41 },
      { rate: 0.06, termYears: 20.5 }
    ]) {
      expect(() => debtService(1000, debt)).toThrow(RangeError);
    }
    expect(() => debtService(-1, { rate: 0.06, termYears: 20 })).toThrow(RangeError);
    expect(() => debtService(NaN, { rate: 0.06, termYears: 20 })).toThrow(RangeError);
  });
});

describe('validateDebt', () => {
  it('accepts the bounds', () => {
    expect(validateDebt({ rate: 0.25, termYears: 1 })).toBeNull();
    expect(validateDebt({ rate: 0.06, termYears: 40 })).toBeNull();
    expect(DEBT_BOUNDS).toEqual({
      rate: { gt: 0, max: 0.25 },
      termYears: { min: 1, max: 40, integer: true }
    });
  });
  it('returns the messages', () => {
    expect(validateDebt({ rate: 0, termYears: 20 })).toBe(RATE_MSG);
    expect(validateDebt({ rate: 0.2501, termYears: 20 })).toBe(RATE_MSG);
    expect(validateDebt({ rate: NaN, termYears: 20 })).toBe(RATE_MSG);
    expect(validateDebt({ rate: 0.06, termYears: 0 })).toBe(TERM_MSG);
    expect(validateDebt({ rate: 0.06, termYears: 41 })).toBe(TERM_MSG);
    expect(validateDebt({ rate: 0.06, termYears: 20.5 })).toBe(TERM_MSG);
  });
});

describe('DEBT_LIMITS', () => {
  it('holds sourced values', () => {
    expect(DEBT_LIMITS.goPolicyRate.value).toBe(0.1201);
    expect(DEBT_LIMITS.goRateToday.value).toBe(0.1105);
    expect(DEBT_LIMITS.goRatePerAnnualDollar.value).toBe(0.01 / 35784254);
    expect(DEBT_LIMITS.goCapShare.value).toBe(0.03);
    expect(DEBT_LIMITS.assessedValue.value).toBe(353600000000);
    expect(DEBT_LIMITS.goOutstanding.value).toBe(2670000000);
    expect(DEBT_LIMITS.copCapShare.value).toBe(0.0325);
    expect(DEBT_LIMITS.discretionaryRevenue.value).toBe(4660000000);
    expect(DEBT_LIMITS.goVote.value).toBe('two thirds');
    expect(DEBT_LIMITS.goPolicyReachedFy.value).toBe('FY 2031-32');
    expect(DEBT_LIMITS.copReachedFy.value).toBe('FY 2028-29');
    for (const entry of Object.values(DEBT_LIMITS)) {
      expect(entry.provenance.tier).toBe(1);
      expect(entry.provenance.sources.length).toBeGreaterThan(0);
    }
  });
});

describe('limitStatements', () => {
  it('is empty for no borrowing', () => {
    expect(limitStatements([])).toEqual([]);
  });
  it('states the go limits for $300 million', () => {
    const s = limitStatements([go(300 * M)]);
    expect(s.map((x) => x.id)).toEqual(['goRate', 'goCap', 'goVote']);
    const [rate, cap, vote] = s;
    expect(rate.text).toContain('$26.2 million a year');
    expect(rate.text).toContain('0.0073%');
    expect(rate.text).toContain('$7.31');
    expect(rate.exceeded).toBe(true);
    expect(cap.text).toContain('$2.97 billion');
    expect(cap.text.endsWith('This is within the cap.')).toBe(true);
    expect(cap.exceeded).toBe(false);
    expect(vote.exceeded).toBe(true);
    expect(vote.text).toBe(
      'City general-obligation bonds need a two-thirds vote of the people voting on them. ' +
        'This run assumes $300.0 million of new bonds that no vote has approved.'
    );
  });
  it('reports over the cap for $8,000 million', () => {
    const cap = limitStatements([go(8000 * M)])[1];
    expect(cap.text.endsWith('This is over the cap.')).toBe(true);
    expect(cap.exceeded).toBe(true);
  });
  it('states the cop limit', () => {
    const s = limitStatements([cop(100 * M)]);
    expect(s.map((x) => x.id)).toEqual(['copCap']);
    expect(s[0].text).toContain('$9.1 million a year');
    expect(s[0].text).toContain('0.19%');
    expect(s[0].exceeded).toBe(true);
  });
  it('orders mixed borrowing and tiers provenance', () => {
    const s = limitStatements([cop(100 * M), go(300 * M)]);
    expect(s.map((x) => x.id)).toEqual(['goRate', 'goCap', 'goVote', 'copCap']);
    expect(s.map((x) => x.provenance.tier)).toEqual([2, 2, 1, 2]);
  });
  it('ignores zero-principal entries', () => {
    expect(limitStatements([go(0), cop(0)])).toEqual([]);
  });
});
