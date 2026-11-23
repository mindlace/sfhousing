import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import type { Result } from './levels';
import { standing } from './standing';

const reached = (y: number, m: number, d: number): Result => ({
  kind: 'reached',
  on: dayFromUtc(y, m, d)
});
const missed: Result = { kind: 'missed', short: 12 };
const BAR = { on: dayFromUtc(2057, 6, 1) };

describe('standing', () => {
  it('level 1 is playing, with a reached seen and a bar', () => {
    expect(standing(1, BAR, reached(2050, 1, 1))).toEqual({ kind: 'playing' });
  });
  it.each([2, 3, 4, 5] as const)('level %i with seen null is playing', (n) => {
    expect(standing(n, BAR, null)).toEqual({ kind: 'playing' });
    expect(standing(n, null, null)).toEqual({ kind: 'playing' });
  });
  it('level 2 reached is won on the day', () => {
    const seen = reached(2060, 1, 1);
    expect(standing(2, null, seen)).toEqual({ kind: 'won', on: dayFromUtc(2060, 1, 1) });
  });
  it('level 2 missed is short with no bar', () => {
    expect(standing(2, null, missed)).toEqual({ kind: 'short', seen: missed, bar: null });
  });
  it.each([3, 4, 5] as const)('level %i reached before the bar month is won', (n) => {
    expect(standing(n, BAR, reached(2057, 5, 31))).toEqual({
      kind: 'won',
      on: dayFromUtc(2057, 5, 31)
    });
  });
  it.each([3, 4, 5] as const)('level %i reached in the bar month is short', (n) => {
    const seen = reached(2057, 6, 20);
    expect(standing(n, BAR, seen)).toEqual({ kind: 'short', seen, bar: BAR });
  });
  it.each([3, 4, 5] as const)('level %i missed is short', (n) => {
    expect(standing(n, BAR, missed)).toEqual({ kind: 'short', seen: missed, bar: BAR });
  });
  it.each([3, 4, 5] as const)('level %i with a null bar and reached is won', (n) => {
    expect(standing(n, null, reached(2070, 1, 1))).toEqual({
      kind: 'won',
      on: dayFromUtc(2070, 1, 1)
    });
  });
  it.each([3, 4, 5] as const)('level %i with a null bar and missed is short', (n) => {
    expect(standing(n, null, missed)).toEqual({ kind: 'short', seen: missed, bar: null });
  });
});
