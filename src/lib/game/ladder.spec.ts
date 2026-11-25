import { describe, expect, it } from 'vitest';
import { LADDER_YEARS } from './catalogue/ladder-years';
import { finished, fitGame, goalAt, ladder, RUNGS, takeNext } from './ladder';

describe('ladder', () => {
  it('has one rung more than the deadline years', () => {
    expect(RUNGS).toBe(LADDER_YEARS.length + 1);
  });

  it('ladder throws until game-core writes it', () => {
    expect(() => ladder({} as never)).toThrow('not implemented');
  });

  it('goalAt throws until game-core writes it', () => {
    expect(() => goalAt({} as never, 0)).toThrow('not implemented');
  });

  it('finished throws until game-core writes it', () => {
    expect(() => finished({} as never)).toThrow('not implemented');
  });

  it('takeNext throws until game-core writes it', () => {
    expect(() => takeNext({} as never)).toThrow('not implemented');
  });

  it('fitGame throws until game-core writes it', () => {
    expect(() => fitGame({} as never)).toThrow('not implemented');
  });
});
