import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { yearMarks } from './axis';

describe('yearMarks', () => {
  it('labels the dataset year at 0, then every fifth year, inside the window', () => {
    const asOf = dayFromUtc(2025, 10, 15);
    const windowEnd = dayFromUtc(2065, 10, 31);
    const marks = yearMarks(asOf, windowEnd);
    expect(marks.map((t) => t.year)).toEqual([
      2025, 2030, 2035, 2040, 2045, 2050, 2055, 2060, 2065
    ]);
    expect(marks[0]).toEqual({ year: 2025, day: asOf, pct: 0 });
    const span = windowEnd - asOf;
    for (const t of marks.slice(1)) {
      expect(t.day).toBe(dayFromUtc(t.year, 1, 1));
      expect(t.pct).toBeCloseTo(((t.day - asOf) / span) * 100, 9);
    }
    // A fortieth year's 1 January past the window's end is left out.
    expect(yearMarks(asOf, dayFromUtc(2064, 12, 31)).at(-1)!.year).toBe(2060);
  });
});
