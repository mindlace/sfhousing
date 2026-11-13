import { describe, expect, it } from 'vitest';
import { dayOf } from '$lib/sim/scenario/dates';
import { monthFirstDay, monthLastDay, monthOfDay } from './months';

const asOf = dayOf(2026, 3, 15);

describe('model months', () => {
  it('abut: the next month starts the day after this one ends', () => {
    for (const m of [1, 2, 12, 13, 480]) {
      expect(monthFirstDay(asOf, m + 1)).toBe(monthLastDay(asOf, m) + 1);
    }
  });
  it('month 1 starts the day after the dataset date', () => {
    expect(monthFirstDay(asOf, 1)).toBe(asOf + 1);
  });
  it('monthOfDay inverts both ends of every month', () => {
    for (let m = 1; m <= 480; m++) {
      expect(monthOfDay(asOf, monthFirstDay(asOf, m))).toBe(m);
      expect(monthOfDay(asOf, monthLastDay(asOf, m))).toBe(m);
    }
  });
  it('the dataset date is month 0', () => {
    expect(monthOfDay(asOf, asOf)).toBe(0);
  });
});
