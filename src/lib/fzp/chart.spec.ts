import { describe, expect, it } from 'vitest';
import { COLORS, SERIES_NAME, niceCeil } from './chart';

describe('niceCeil', () => {
  it.each([
    [0, 1],
    [1, 1],
    [1.2, 2],
    [3, 5],
    [7, 10],
    [82069, 100000],
    [120001, 200000],
    [100000, 100000],
    [350, 500]
  ])('niceCeil(%d) = %d', (v, want) => {
    expect(niceCeil(v)).toBe(want);
  });
});

describe('series names and colours', () => {
  it('names every series', () => {
    expect(Object.keys(SERIES_NAME)).toEqual([
      'total',
      'pipeline',
      'fresh',
      'planCompleted',
      'planEntitled'
    ]);
    expect(SERIES_NAME).toEqual({
      total: 'Toward the goal, since Jun 2022',
      pipeline: "From today's pipeline",
      fresh: 'New projects',
      planCompleted: 'Plan effect, completed',
      planEntitled: 'Plan effect, approved'
    });
    expect(COLORS).toEqual({
      total: 'var(--chart-total)',
      pipeline: 'var(--chart-pipeline)',
      fresh: 'var(--chart-fresh)',
      plan: 'var(--chart-plan)'
    });
  });
});
