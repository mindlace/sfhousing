import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { beats, LAST_LEVEL, paintWon, type Result } from './levels';

const reached = (y: number, m: number, d: number): Result => ({
  kind: 'reached',
  on: dayFromUtc(y, m, d)
});
const JUNE_2057 = { on: dayFromUtc(2057, 6, 1) };

describe('beats', () => {
  it.each([
    ['reached, May 2057', reached(2057, 5, 1), true],
    ['reached, December 2056', reached(2056, 12, 1), true],
    ['reached, 30 June 2057', reached(2057, 6, 30), false],
    ['reached, July 2057', reached(2057, 7, 1), false],
    ['missed by 1 home', { kind: 'missed', short: 1 } as Result, false]
  ])('%s against June 2057 is %s', (_, seen, want) => {
    expect(beats(seen, JUNE_2057)).toBe(want);
  });
  it('a result on the 31st of the month before beats a bar on the 1st', () => {
    expect(beats(reached(2057, 5, 31), JUNE_2057)).toBe(true);
  });
  it('December beats January of the next year', () => {
    expect(beats(reached(2056, 12, 31), { on: dayFromUtc(2057, 1, 1) })).toBe(true);
  });
  it('any day of the bar month ties', () => {
    expect(beats(reached(2057, 6, 1), { on: dayFromUtc(2057, 6, 20) })).toBe(false);
  });
});

describe('paintWon', () => {
  it.each([
    [81_999, false],
    [82_000, true],
    [82_001, true]
  ])('net %i against 82,000 is %s', (net, want) => {
    expect(paintWon(net, 82_000)).toBe(want);
  });
  it('LAST_LEVEL is 5', () => {
    expect(LAST_LEVEL).toBe(5);
  });
});
