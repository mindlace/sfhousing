import { describe, expect, it } from 'vitest';
import { P } from '../scenario/rng';
import { CAR_P, IN_MIX_DRAW, MIXES } from './types';

describe('car draw purposes', () => {
  it('clash with no P purpose and no retired one, and are distinct', () => {
    const vals = Object.values(CAR_P);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) {
      expect(Object.values(P)).not.toContain(v);
      expect(v < 17 || v > 23).toBe(true);
    }
  });

  it('puts the in-mover mix right after the four mixes', () => {
    expect(IN_MIX_DRAW).toBe(MIXES.length);
  });
});
