import { describe, expect, it } from 'vitest';
import {
  HORIZON,
  YEAR_2045,
  dayFromUtc,
  monthIndex,
  monthStart,
  nextMonth,
  prevMonth,
  shiftYear,
  utcParts
} from './time';

const asOf = dayFromUtc(2026, 10, 16);
const month0 = dayFromUtc(2026, 10, 1);
const length = 291;

describe('dayFromUtc / utcParts', () => {
  it('pins the horizon at Day 29584', () => {
    expect(dayFromUtc(2050, 12, 31)).toBe(29584);
    expect(HORIZON).toBe(29584);
    expect(YEAR_2045).toBe(dayFromUtc(2045, 1, 1));
  });

  it('decodes parts', () => {
    expect(utcParts(dayFromUtc(2031, 3, 4))).toEqual({ y: 2031, m: 3, d: 4 });
  });

  it('round-trips every day of the leap year 2028', () => {
    const start = dayFromUtc(2028, 1, 1);
    const end = dayFromUtc(2028, 12, 31);
    expect(end - start).toBe(365);
    for (let day = start; day <= end; day++) {
      const { y, m, d } = utcParts(day);
      expect(dayFromUtc(y, m, d)).toBe(day);
      expect(y).toBe(2028);
    }
  });
});

describe('monthStart', () => {
  it('returns the first of the month', () => {
    expect(monthStart(dayFromUtc(2031, 3, 17))).toBe(dayFromUtc(2031, 3, 1));
    expect(monthStart(dayFromUtc(2031, 3, 1))).toBe(dayFromUtc(2031, 3, 1));
  });
});

describe('nextMonth', () => {
  it('steps to the next first-of-month strictly after the day', () => {
    expect(nextMonth(dayFromUtc(2026, 11, 1), HORIZON)).toBe(dayFromUtc(2026, 12, 1));
    expect(nextMonth(dayFromUtc(2026, 10, 31), HORIZON)).toBe(dayFromUtc(2026, 11, 1));
    expect(nextMonth(asOf, HORIZON)).toBe(dayFromUtc(2026, 11, 1));
    expect(nextMonth(dayFromUtc(2026, 12, 15), HORIZON)).toBe(dayFromUtc(2027, 1, 1));
  });

  it('clamps to the horizon', () => {
    expect(nextMonth(dayFromUtc(2050, 12, 1), HORIZON)).toBe(HORIZON);
    expect(nextMonth(HORIZON, HORIZON)).toBe(HORIZON);
  });
});

describe('prevMonth', () => {
  it('steps to the previous first-of-month strictly before the day', () => {
    expect(prevMonth(dayFromUtc(2026, 12, 1), asOf)).toBe(dayFromUtc(2026, 11, 1));
    expect(prevMonth(dayFromUtc(2026, 12, 31), asOf)).toBe(dayFromUtc(2026, 12, 1));
  });

  it('clamps up to asOf', () => {
    expect(prevMonth(dayFromUtc(2026, 11, 1), asOf)).toBe(asOf);
    expect(prevMonth(asOf, asOf)).toBe(asOf);
  });
});

describe('shiftYear', () => {
  it('moves twelve months from the current month start, clamped', () => {
    expect(shiftYear(dayFromUtc(2027, 3, 17), 1, asOf, HORIZON)).toBe(dayFromUtc(2028, 3, 1));
    expect(shiftYear(dayFromUtc(2027, 3, 17), -1, asOf, HORIZON)).toBe(asOf);
    expect(shiftYear(dayFromUtc(2050, 2, 10), 1, asOf, HORIZON)).toBe(HORIZON);
  });

  it('goes back a full year when that stays after asOf', () => {
    expect(shiftYear(dayFromUtc(2029, 5, 20), -1, asOf, HORIZON)).toBe(dayFromUtc(2028, 5, 1));
  });
});

describe('monthIndex', () => {
  it('counts calendar months from month0, clamped', () => {
    expect(monthIndex(asOf, month0, length)).toBe(0);
    expect(monthIndex(dayFromUtc(2026, 10, 31), month0, length)).toBe(0);
    expect(monthIndex(dayFromUtc(2026, 11, 1), month0, length)).toBe(1);
    expect(monthIndex(HORIZON, month0, length)).toBe(290);
    expect(monthIndex(month0 - 40, month0, length)).toBe(0);
    expect(monthIndex(HORIZON + 400, month0, length)).toBe(290);
  });
});
