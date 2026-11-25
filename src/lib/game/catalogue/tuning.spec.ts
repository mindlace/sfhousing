import { describe, expect, it } from 'vitest';
import { NEW_GAME } from '../state';
import { SIDE_GOALS } from '../side-goals';
import { treeView } from '../tree';
import { CATALOGUE } from './nodes';
import { PRICES, RUNG_LUMP, SIDE_TUNING } from './tuning';

const whole = (n: number) => Number.isInteger(n) && n > 0;

describe('tuning', () => {
  it('RUNG_LUMP is a whole number above 0 of home', () => {
    expect(Object.keys(RUNG_LUMP)).toEqual(['home']);
    expect(whole(RUNG_LUMP.home ?? 0)).toBe(true);
  });

  it('SIDE_TUNING has one entry for each side goal game-core defines', () => {
    expect(SIDE_GOALS.length).toBe(11);
    expect(Object.keys(SIDE_TUNING).length).toBe(11);
    expect(SIDE_GOALS.map((g) => g.id)).toEqual([
      'policy-homes-1',
      'collect-share-1',
      'approved-homes',
      'collect-run',
      'policy-homes-2',
      'new-money',
      'funded-homes',
      'collect-share-2',
      'building-homes',
      'affordable-homes',
      'policy-homes-3'
    ]);
    for (const t of Object.values(SIDE_TUNING)) {
      expect(whole(t.target)).toBe(true);
      expect(Object.keys(t.reward)).toEqual(['home']);
      expect(whole(t.reward.home ?? 0)).toBe(true);
    }
  });

  it('PRICES has one rising list of whole prices for each catalogue node', () => {
    expect(Object.keys(PRICES).sort()).toEqual(CATALOGUE.map((e) => e.id).sort());
    for (const entry of CATALOGUE) {
      const prices = PRICES[entry.id];
      expect(prices.length).toBe(entry.levels.length);
      prices.forEach((p, i) => {
        expect(whole(p)).toBe(true);
        if (i > 0) expect(p).toBeGreaterThan(prices[i - 1]);
      });
    }
  });

  it('the cheapest next level shown in a new game costs no more than RUNG_LUMP', () => {
    const costs = treeView(NEW_GAME).map((v) => v.node.levels[v.level].price.home ?? 0);
    expect(Math.min(...costs)).toBeLessThanOrEqual(RUNG_LUMP.home ?? 0);
  });
});
