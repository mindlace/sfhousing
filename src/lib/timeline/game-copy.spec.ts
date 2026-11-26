import { describe, expect, it } from 'vitest';
import { LOCKED_LANE, NOT_BOUGHT, goalUnlocks } from './game-copy';

describe('the tree words', () => {
  it('exports only the tree words', async () => {
    expect(Object.keys(await import('./game-copy')).sort()).toEqual([
      'LOCKED_LANE',
      'NOT_BOUGHT',
      'goalUnlocks'
    ]);
  });
  it('fixed words', () => {
    expect(NOT_BOUGHT).toBe('Not bought yet');
    expect(LOCKED_LANE).toBe('Opens in the tree');
  });
  it('goalUnlocks counts levers', () => {
    expect(goalUnlocks(0, true)).toBe('an earlier goal');
    expect(goalUnlocks(1, true)).toBe('1 lever and an earlier goal');
    expect(goalUnlocks(4, true)).toBe('4 levers and an earlier goal');
    expect(goalUnlocks(1, false)).toBe('1 lever');
    expect(goalUnlocks(4, false)).toBe('4 levers');
  });
});
