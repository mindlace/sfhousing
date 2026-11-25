import { describe, expect, it } from 'vitest';
import { NEW_GAME } from '../state';
import { SIDE_GOALS, sideGoals } from '../side-goals';
import { treeView } from '../tree';
import { CATALOGUE } from './nodes';
import { PRICES, RUNG_LUMP, SIDE_TUNING } from './tuning';

const whole = (n: number) => Number.isInteger(n) && n > 0;

describe('tuning', () => {
  it('RUNG_LUMP is a whole number above 0 of home', () => {
    expect(Object.keys(RUNG_LUMP)).toEqual(['home']);
    expect(whole(RUNG_LUMP.home ?? 0)).toBe(true);
  });

  it('SIDE_GOALS is the entered subset of game-core goals, in order, every ring offered', () => {
    // Every goal game-core defines, in its order: a tuning with an entry for any id.
    const any = new Proxy({} as Record<string, { target: number; reward: { home: number } }>, {
      get: () => ({ target: 1, reward: { home: 1 } })
    });
    const defined = sideGoals(any);
    expect(defined.length).toBe(11);
    const entered = Object.keys(SIDE_TUNING);
    expect(SIDE_GOALS.length).toBe(entered.length);
    expect(SIDE_GOALS.map((g) => g.id)).toEqual(
      defined.map((g) => g.id).filter((id) => entered.includes(id))
    );
    const lastRing = Math.max(...defined.map((g) => g.ring));
    for (let ring = 0; ring <= lastRing; ring++) {
      expect(SIDE_GOALS.some((g) => g.ring === ring)).toBe(true);
    }
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
