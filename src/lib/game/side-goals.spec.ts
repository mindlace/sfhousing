import { describe, expect, it } from 'vitest';
import { SIDE_GOALS, SIDE_SHOWN, sideShown } from './side-goals';

describe('side-goals', () => {
  it('starts with no goals and shows three', () => {
    expect(SIDE_GOALS).toEqual([]);
    expect(SIDE_SHOWN).toBe(3);
  });

  it('sideShown throws until game-core writes it', () => {
    expect(() => sideShown({} as never)).toThrow('not implemented');
  });
});
