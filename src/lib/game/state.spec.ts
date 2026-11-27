import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_GAME } from './state';

describe('state', () => {
  it('NEW_GAME is the opening of a version 3 game', () => {
    expect(NEW_GAME).toEqual({
      v: 3,
      phase: 'opening',
      firstWinAt: null,
      round: 0,
      target: null,
      editable: [],
      wins: [],
      finished: false,
      own: false
    });
  });

  it('NEW_GAME and its two lists are frozen', () => {
    for (const o of [NEW_GAME, NEW_GAME.editable, NEW_GAME.wins]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });

  it.each(['./state.ts', './save-shape.ts', './upgrade.ts'])(
    '%s has no value import from $lib',
    (f) => {
      const text = readFileSync(new URL(f, import.meta.url), 'utf8');
      const values = [...text.matchAll(/^import (?!type\b)[^;]*? from '([^']+)';/gms)].map(
        (m) => m[1]
      );
      expect(values.filter((p) => p.startsWith('$lib/'))).toEqual([]);
    }
  );
});
