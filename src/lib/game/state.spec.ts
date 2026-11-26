import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_GAME, UNIT_KINDS } from './state';

describe('state', () => {
  it('has the one unit kind', () => {
    expect(UNIT_KINDS).toEqual(['home']);
  });

  it('NEW_GAME is the opening', () => {
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

  it('NEW_GAME and its four nested objects are frozen', () => {
    for (const o of [NEW_GAME, NEW_GAME.bought, NEW_GAME.units, NEW_GAME.met, NEW_GAME.side]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });

  it.each(['./state.ts', './save-shape.ts'])('%s has no value import from $lib', (f) => {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8');
    const values = [...text.matchAll(/^import (?!type\b)[^;]*? from '([^']+)';/gms)].map(
      (m) => m[1]
    );
    expect(values.filter((p) => p.startsWith('$lib/'))).toEqual([]);
  });
});
