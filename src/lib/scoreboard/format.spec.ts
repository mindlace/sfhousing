import { describe, expect, it } from 'vitest';
import { formatBuiltDate, formatCompactCount, formatCount, formatPercent } from './format';

describe('formatPercent (spec §6)', () => {
  it.each([
    [0, '0%'],
    [0.004, '0.4%'],
    [0.0999, '9.9%'],
    [0.9999, '99%'],
    [1, '100%'],
    [1.8049, '180%']
  ])('%d → %s', (fraction, expected) => {
    expect(formatPercent(fraction)).toBe(expected);
  });

  it('is never clamped: 2.0 → 200%, 12.345 → 1,234%', () => {
    expect(formatPercent(2)).toBe('200%');
    expect(formatPercent(12.345)).toBe('1,234%');
  });

  it('defeats float error: 0.29 → 29%, 0.57 → 57%', () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE-754
    expect(formatPercent(0.29)).toBe('29%');
    expect(formatPercent(0.57)).toBe('57%');
  });

  it('never shows 100% before the target is met', () => {
    expect(formatPercent(82068 / 82069)).toBe('99%');
    expect(formatPercent(94378 / 94379)).toBe('99%');
    expect(formatPercent(82069 / 82069)).toBe('100%');
  });

  it('every integer net against each M1 target floors exactly', () => {
    for (const units of [82069, 94379]) {
      for (let net = 0; net <= 3 * units; net += 997) {
        const exactTenths = Math.floor((net * 1000) / units); // floor(p*10), integer math
        const p = (net * 100) / units;
        const expected =
          net === 0
            ? '0%'
            : p < 10
              ? `${(exactTenths / 10).toFixed(1)}%`
              : `${Math.floor((net * 100) / units).toLocaleString('en-US')}%`;
        expect(formatPercent(net / units)).toBe(expected);
      }
    }
  });

  it('shows one decimal below 10%, even when it is .0', () => {
    expect(formatPercent(0.05)).toBe('5.0%');
    expect(formatPercent(0.0004)).toBe('0.0%');
  });

  it('formats negatives with U+2212 and treats -0 as 0', () => {
    expect(formatPercent(-0)).toBe('0%');
    expect(formatPercent(-0.004)).toBe('−0.4%');
    expect(formatPercent(-0.0045)).toBe('−0.5%');
    expect(formatPercent(-1.5)).toBe('−150%');
  });
});

describe('formatCount', () => {
  it('82069 → "82,069"', () => {
    expect(formatCount(82069)).toBe('82,069');
  });

  it('−5 → "−5" with U+2212', () => {
    expect(formatCount(-5)).toBe('−5');
    expect(formatCount(-1234)).toBe('−1,234');
  });

  it('0 and -0 → "0"', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(-0)).toBe('0');
  });
});

describe('formatCompactCount', () => {
  it('compact 123456 → "123.5K"', () => {
    expect(formatCompactCount(123456)).toBe('123.5K');
  });

  it('uses the exact count below 100,000', () => {
    expect(formatCompactCount(99999)).toBe('99,999');
    expect(formatCompactCount(-200000)).toBe('−200,000');
  });

  it('switches at exactly 100,000', () => {
    expect(formatCompactCount(100000)).toBe('100K');
  });
});

describe('formatBuiltDate', () => {
  it('takes the literal YYYY-MM-DD prefix, with no timezone shift', () => {
    expect(formatBuiltDate('2026-10-10T23:30:00-07:00')).toBe('2026-10-10');
    expect(formatBuiltDate('2026-10-10T01:00:00Z')).toBe('2026-10-10');
    expect(formatBuiltDate('2026-10-10')).toBe('2026-10-10');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatBuiltDate('unknown')).toBe('unknown');
  });
});
