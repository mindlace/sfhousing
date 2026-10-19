import { describe, expect, it } from 'vitest';
import {
  formatCardDate,
  formatChance,
  formatDate,
  formatMonthYear,
  formatShortMonthYear
} from './format';
import { dayFromUtc } from './time';

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
