import { describe, expect, it } from 'vitest';
import { addMonths, dayOf, firstOfMonth, isoOf } from './dates';

describe('scenario dates', () => {
  it('anchors the epoch at day 0', () => {
    expect(dayOf(1970, 1, 1)).toBe(0);
  });

  it('round-trips ISO dates', () => {
    expect(isoOf(dayOf(2026, 10, 16))).toBe('2026-10-16');
    expect(isoOf(dayOf(2050, 12, 31))).toBe('2050-12-31');
  });

  it('adds months across a year boundary', () => {
    expect(addMonths(dayOf(2026, 10, 1), 3)).toBe(dayOf(2027, 1, 1));
  });

  it('finds the first of the month', () => {
    expect(firstOfMonth(dayOf(2026, 10, 16))).toBe(dayOf(2026, 10, 1));
  });
});
