import { describe, expect, it } from 'vitest';
import type { PlanOp } from '$lib/plan';
import { paintedSummary, storiesUsed } from './summary';

const paint = (id: string, stories: number): PlanOp => ({
  kind: 'paint',
  id,
  stories,
  radiusM: 20,
  path: [[-122.4, 37.7]]
});
const erase = (id: string): PlanOp => ({ kind: 'erase', id, radiusM: 20, path: [[-122.4, 37.7]] });

describe('the read-only summary', () => {
  it('lists the heights used, ascending, once each', () => {
    expect(storiesUsed([paint('a', 8), erase('b'), paint('c', 6), paint('d', 8)])).toEqual([6, 8]);
    expect(storiesUsed([erase('a')])).toEqual([]);
    expect(storiesUsed([])).toEqual([]);
  });

  it('joins the heights and counts the lots rebuilt', () => {
    expect(paintedSummary([6], 1)).toBe('6 stories · 1 lot rebuilt');
    expect(paintedSummary([1], 0)).toBe('1 story · 0 lots rebuilt');
    expect(paintedSummary([6, 8], 1204)).toBe('6 and 8 stories · 1,204 lots rebuilt');
    expect(paintedSummary([4, 6, 8], 12)).toBe('4, 6 and 8 stories · 12 lots rebuilt');
    expect(paintedSummary([], 5)).toBe('Nothing painted');
  });
});
