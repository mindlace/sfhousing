import { describe, expect, it } from 'vitest';
import {
  formatCardDate,
  formatChance,
  formatDate,
  formatDollars,
  formatDollarsExact,
  formatMonthYear,
  formatOddsChange,
  formatShortMonthYear,
  formatSourcePercent,
  monthYearLabels
} from './format';
import { dayFromUtc } from './time';
import { PROTOTYPES, fundBundle, isCertain, resolveTerms } from '$lib/sim/finance';
import { parseFinanceLevers } from '$lib/sim/levers/finance';
import { BOND_POLICY, TERM_POLICY, fundingCalibration } from '$lib/sim-page/test/funding';

describe('date formatters', () => {
  it('formats long, short and full dates', () => {
    expect(formatMonthYear(dayFromUtc(2031, 3, 1))).toBe('March 2031');
    expect(formatShortMonthYear(dayFromUtc(2026, 10, 16))).toBe('Oct 2026');
    expect(formatDate(dayFromUtc(2031, 3, 4))).toBe('Mar 4, 2031');
  });

  it('reads UTC midnight regardless of the browser zone', () => {
    expect(formatDate(dayFromUtc(2030, 12, 31))).toBe('Dec 31, 2030');
    expect(formatMonthYear(dayFromUtc(2031, 1, 1))).toBe('January 2031');
  });
});

describe('formatCardDate', () => {
  const asOf = dayFromUtc(2026, 10, 16);

  it('uses the full date up to asOf and month-year after', () => {
    expect(formatCardDate(asOf, asOf)).toBe('Oct 16, 2026');
    expect(formatCardDate(dayFromUtc(2025, 9, 12), asOf)).toBe('Sep 12, 2025');
    expect(formatCardDate(asOf + 1, asOf)).toBe('Oct 2026');
    expect(formatCardDate(dayFromUtc(2031, 3, 4), asOf)).toBe('Mar 2031');
  });
});

describe('formatChance', () => {
  it.each([
    [0, 'under 1%'],
    [0.004, 'under 1%'],
    [0.005, '1%'],
    [0.62, '62%'],
    [0.994, '99%'],
    [0.996, 'over 99%'],
    [1, 'over 99%']
  ])('formats %s as %s', (p, text) => {
    expect(formatChance(p)).toBe(text);
  });
});

describe('monthYearLabels', () => {
  it('lists the twelve month labels of a year', () => {
    const labels = monthYearLabels(2066);
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe('January 2066');
    expect(labels[8]).toBe('September 2066');
  });
});

describe('money and odds formats', () => {
  it.each([
    [0, '$0'],
    [999, '$1,000'],
    [412_499, '$412,000'],
    [999_500, '$1 million'],
    [1_000_000, '$1 million'],
    [26_155_367, '$26.2 million'],
    [999_999_999, '$1 billion'],
    [1_250_000_000, '$1.25 billion'],
    [-412_499, '\u2212$412,000']
  ])('formatDollars(%d) is %s', (n, s) => expect(formatDollars(n)).toBe(s));

  it('formatDollarsExact', () => {
    expect(formatDollarsExact(300_027)).toBe('$300,027');
    expect(formatDollarsExact(181_637)).toBe('$181,637');
    expect(formatDollarsExact(0)).toBe('$0');
    expect(formatDollarsExact(-1234)).toBe('\u2212$1,234');
  });

  it('formatSourcePercent rounds to one decimal', () => {
    expect(formatSourcePercent(0.115)).toBe('11.5%');
    expect(formatSourcePercent(0.8)).toBe('80%');
  });

  it('formatOddsChange truncates and caps', () => {
    expect(formatOddsChange((1.75 * 50_000) / 736_700)).toBe('+12%');
    expect(formatOddsChange(Math.log(11))).toBe('more than 10 times as likely');
    expect(formatOddsChange(0)).toBe('+0%');
    expect(formatOddsChange(Math.log(0.955))).toBe('\u22124%');
  });
});

describe('the funding test fragment', () => {
  it('has programme shares summing to 1 that the bundle covers with certainty', () => {
    const bf = fundingCalibration().baselineFunding!;
    const shares = bf.programmes.map((p) =>
      p.instrument.kind === 'grant' ? p.instrument.share : 0
    );
    expect(Math.abs(shares.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
    const kindOf = (id: string) => bf.pools.find((p) => p.id === id)!.kind;
    const items = bf.programmes.map((p) => ({
      instrument: p.instrument,
      poolKind: kindOf(p.pool)
    }));
    const f = fundBundle(items, 'affordable', PROTOTYPES[0], resolveTerms());
    expect(isCertain(f.coverage)).toBe(true);
  });

  it('has policies that parse as finance levers', () => {
    for (const p of [BOND_POLICY, TERM_POLICY]) {
      expect(parseFinanceLevers(JSON.parse(JSON.stringify(p.funding)), 'finance')).toEqual(
        p.funding
      );
    }
  });
});
