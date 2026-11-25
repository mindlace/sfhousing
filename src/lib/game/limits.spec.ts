import { describe, expect, it } from 'vitest';
import { STORIES_MAX } from '$lib/plan/constants';
import { STOP_TYPES } from '$lib/sim/levers/brushes';
import { PRESETS } from '$lib/sim-page/timing';
import { BAND_MAX_M, MAX_BANDS } from '$lib/sim-page/transit-edit';
import {
  BASE_HANDS,
  FREE_MEASURES,
  isGiven,
  limitsOf,
  OPEN_LIMITS,
  runnable,
  START_BANDS,
  START_REACH_M,
  START_STORIES,
  within
} from './limits';

describe('limits constants', () => {
  it('has the base hands', () => {
    expect(BASE_HANDS).toEqual({ radiusPx: 48, lingerMs: 4000, auto: false });
  });

  it('has the starting values', () => {
    expect([START_BANDS, START_STORIES, START_REACH_M]).toEqual([1, 4, 402]);
  });

  it('has the free measures', () => {
    expect(FREE_MEASURES).toEqual(['state-off', 'federal-credits-off']);
  });

  it('opens the open limits', () => {
    expect(OPEN_LIMITS.open).toBe(true);
    expect(OPEN_LIMITS.custom).toBe(true);
    expect(OPEN_LIMITS.measures.size).toBe(0);
    expect(OPEN_LIMITS.hands).toBe(BASE_HANDS);
  });

  it('ties the open limits to the constants they copy', () => {
    expect([...OPEN_LIMITS.presets].sort()).toEqual(PRESETS.map((p) => p.id).sort());
    expect([...OPEN_LIMITS.stops].sort()).toEqual([...STOP_TYPES].sort());
    expect(OPEN_LIMITS.bands).toBe(MAX_BANDS);
    expect(OPEN_LIMITS.reachM).toBe(BAND_MAX_M);
    expect(OPEN_LIMITS.stories).toBe(STORIES_MAX);
  });
});

describe('limits stubs', () => {
  it('limitsOf throws until game-core writes it', () => {
    expect(() => limitsOf({} as never)).toThrow('not implemented');
  });

  it('within throws until game-core writes it', () => {
    expect(() => within({} as never, {} as never, {} as never)).toThrow('not implemented');
  });

  it('runnable throws until game-core writes it', () => {
    expect(() => runnable({} as never, {} as never)).toThrow('not implemented');
  });

  it('isGiven throws until game-core writes it', () => {
    expect(() => isGiven({} as never)).toThrow('not implemented');
  });
});
