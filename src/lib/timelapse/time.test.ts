import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../generator/seed';
import {
  DYING_DAYS,
  MONTH_DAYS,
  OPEN_DAY,
  monthsIn,
  stageDay,
  stageMonths,
  type Day
} from './time';

describe('monthsIn', () => {
  it('flips exactly at each month boundary for k = 1..240', () => {
    for (let k = 1; k <= 240; k++) {
      const boundary = Math.ceil(k * MONTH_DAYS);
      expect(monthsIn(0, boundary - 1)).toBe(k - 1);
      expect(monthsIn(0, boundary)).toBe(k);
    }
  });

  it('matches literal spot checks around the first month boundaries', () => {
    expect(monthsIn(0, 30)).toBe(0);
    expect(monthsIn(0, 31)).toBe(1);
    expect(monthsIn(0, 60)).toBe(1);
    expect(monthsIn(0, 61)).toBe(2);
  });

  it('is zero on the entry day and floors negative offsets', () => {
    expect(monthsIn(100, 100)).toBe(0);
    expect(monthsIn(100, 99)).toBe(-1);
  });
});

describe('constants', () => {
  it('OPEN_DAY is exact and finite in Float32', () => {
    expect(Math.fround(OPEN_DAY)).toBe(OPEN_DAY);
    expect(Number.isFinite(Math.fround(OPEN_DAY))).toBe(true);
  });

  it('MONTH_DAYS is the Gregorian mean month', () => {
    expect(MONTH_DAYS).toBe(365.2425 / 12);
  });

  it('DYING_DAYS is 270', () => {
    expect(DYING_DAYS).toBe(270);
  });

  it('Day values round-trip through Float32 exactly', () => {
    const days: Day[] = [0, 30000];
    const f = new Float32Array(days);
    expect(Array.from(f)).toEqual(days);
  });
});

describe('stageDay and stageMonths', () => {
  it('stageDay puts month k on its own days', () => {
    for (let k = 1; k <= 240; k++) {
      expect(stageDay(k - 1)).toBe(Math.ceil((k - 1) * MONTH_DAYS));
      expect(stageDay(k - 1e-9)).toBe(Math.ceil(k * MONTH_DAYS) - 1);
    }
    const rng = mulberry32(0x5eed);
    let bad = 0;
    for (let i = 0; i < 10000; i++) {
      const x = rng() * 600;
      if (monthsIn(0, stageDay(x)) !== Math.floor(x)) bad++;
    }
    expect(bad).toBe(0);
  });

  it('stageMonths(0) is 0', () => {
    expect(stageMonths(0)).toBe(0);
  });

  it('stageMonths inverts stageDay on every day below 2^24', () => {
    let bad = 0;
    for (let d = 0; d < 16777216; d++) {
      if (stageDay(stageMonths(d)) !== d) bad++;
      if (!(stageMonths(d + 1) > stageMonths(d))) bad++;
    }
    expect(bad).toBe(0);
  });
});
