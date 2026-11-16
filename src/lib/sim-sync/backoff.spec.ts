import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('doubles from 1 s and stops at 30 s', () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 6, 60].map((a) => backoffDelay(a, mid))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000
    ]);
  });
  it('jitters by 20% either way', () => {
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 0.999999)).toBe(1200);
    expect(backoffDelay(10, () => 0)).toBe(24000);
  });
  it('clamps a negative, fractional or NaN attempt to a whole number of at least 0', () => {
    const mid = () => 0.5;
    expect([-3, NaN, -Infinity].map((a) => backoffDelay(a, mid))).toEqual([1000, 1000, 1000]);
    expect(backoffDelay(1.9, mid)).toBe(2000);
    expect(backoffDelay(Infinity, mid)).toBe(30000);
  });
});
