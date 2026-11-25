import { describe, expect, it } from 'vitest';
import { LADDER_YEARS } from './ladder-years';

describe('ladder-years', () => {
  it('holds one to four years, latest first, each a multiple of 5', () => {
    expect(LADDER_YEARS.length).toBeGreaterThanOrEqual(1);
    expect(LADDER_YEARS.length).toBeLessThanOrEqual(4);
    for (const y of LADDER_YEARS) {
      expect(Number.isInteger(y)).toBe(true);
      expect(y % 5).toBe(0);
    }
    LADDER_YEARS.forEach((y, i) => {
      if (i > 0) expect(y).toBeLessThan(LADDER_YEARS[i - 1]);
    });
  });
});
