import { describe, expect, it } from 'vitest';
import { NEW_GAME, UNIT_KINDS } from './state';

describe('state', () => {
  it('has the one unit kind', () => {
    expect(UNIT_KINDS).toEqual(['home']);
  });

  it('opens a new game with nothing', () => {
    expect(NEW_GAME).toEqual({
      v: 2,
      phase: 'opening',
      firstWinAt: null,
      bought: {},
      units: {},
      rung: 0,
      met: [],
      side: {},
      runs: 0,
      last: null
    });
  });
});
