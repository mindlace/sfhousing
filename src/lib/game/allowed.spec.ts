import { describe, expect, it } from 'vitest';

import type { Policy, Selector, SimPolicy4 } from '$lib/timeline/policy4';
import {
  ALL_ALLOWED,
  allowedAt,
  isGiven,
  levelNeeded,
  needsHigher,
  playable,
  runs,
  simLocked,
  unlocksAt,
  type Allowed
} from './allowed';
import type { Level } from './levels';
import type { Progress } from './progress';

let n = 0;
const pol = (where: Selector, preset: string | null = null, on = true): Policy => ({
  id: `p${++n}`,
  label: 'x',
  preset,
  on,
  where,
  spans: []
});
const permit = (on = true) => pol({ tag: 'routes' }, 'faster', on);
const zone = () => pol({ tag: 'painted' }, 'zoning-preset');
const given = (where: Selector = { tag: 'fund', pool: 'htf' }) => pol(where, 'housing-bond');
const custom = () => pol({ tag: 'fund', pool: 'htf' }, null);
const doc = (k: Partial<SimPolicy4['kinds']>): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning: [], permitting: [], money: [], ...k }
});
const lv = (level: Level): Progress => ({ v: 1, level, banked: {}, firstWinAt: null });
const levels: Level[] = [1, 2, 3, 4, 5];

describe('ALL_ALLOWED and allowedAt', () => {
  it('ALL_ALLOWED has the three kinds and money all', () => {
    expect([...ALL_ALLOWED.kinds].sort()).toEqual(['money', 'permitting', 'zoning']);
    expect(ALL_ALLOWED.money).toBe('all');
  });

  it('allowedAt gives one object per level', () => {
    for (const l of levels) {
      expect(allowedAt(l)).toBe(allowedAt(l));
      expect(allowedAt(l)).not.toBe(ALL_ALLOWED);
      expect(allowedAt(l).money).toBe('given');
    }
    expect([...allowedAt(1).kinds]).toEqual([]);
    expect([...allowedAt(2).kinds]).toEqual([]);
    expect([...allowedAt(3).kinds].sort()).toEqual(['permitting']);
    expect([...allowedAt(4).kinds].sort()).toEqual(['permitting', 'zoning']);
    expect([...allowedAt(5).kinds].sort()).toEqual(['money', 'permitting', 'zoning']);
  });

  it('unlocksAt', () => {
    expect(unlocksAt('permitting')).toBe(3);
    expect(unlocksAt('zoning')).toBe(4);
    expect(unlocksAt('money')).toBe(5);
  });
});

describe('runs', () => {
  const at = (l: Level | 'all'): Allowed => (l === 'all' ? ALL_ALLOWED : allowedAt(l));
  const cases: [Level | 'all', boolean, boolean, boolean, boolean][] = [
    // level, permitting, zoning, given money, custom money
    [1, false, false, false, false],
    [2, false, false, false, false],
    [3, true, false, false, false],
    [4, true, true, false, false],
    [5, true, true, true, false],
    ['all', true, true, true, true]
  ];
  for (const [l, pe, zo, gi, cu] of cases) {
    it(`runs table at ${l}`, () => {
      expect(runs('permitting', permit(), at(l))).toBe(pe);
      expect(runs('zoning', zone(), at(l))).toBe(zo);
      expect(runs('money', given(), at(l))).toBe(gi);
      expect(runs('money', custom(), at(l))).toBe(cu);
    });
  }

  it('runs ignores on', () => {
    expect(runs('permitting', permit(false), allowedAt(3))).toBe(true);
  });

  it('isGiven', () => {
    expect(isGiven(given())).toBe(true);
    expect(isGiven(given({ tag: 'baseline' }))).toBe(true);
    expect(isGiven(given({ tag: 'terms' }))).toBe(true);
    expect(isGiven(custom())).toBe(false);
    expect(isGiven(permit())).toBe(false);
    expect(isGiven(zone())).toBe(false);
  });
});

describe('playable', () => {
  it('keeps the same object when nothing goes', () => {
    const d = doc({ permitting: [permit()], zoning: [zone()], money: [given()] });
    expect(playable(d, allowedAt(5))).toBe(d);
    const empty = doc({});
    for (const l of levels) expect(playable(empty, allowedAt(l))).toBe(empty);
    const withCustom = doc({ permitting: [permit()], money: [custom(), given()] });
    expect(playable(withCustom, ALL_ALLOWED)).toBe(withCustom);
  });

  it('at level 3 drops zoning and money, keeps the permitting array', () => {
    const a = permit();
    const b = permit(false);
    const d = doc({ permitting: [a, b], zoning: [zone()], money: [given()] });
    const r = playable(d, allowedAt(3));
    expect(r).not.toBe(d);
    expect(r.kinds.zoning).toEqual([]);
    expect(r.kinds.money).toEqual([]);
    expect(r.kinds.permitting).toBe(d.kinds.permitting);
  });

  it('keeps policy order', () => {
    const [a, b, c] = [permit(), permit(false), permit()];
    const g1 = given();
    const g2 = given({ tag: 'terms' });
    const d = doc({ permitting: [a, b, c], money: [g1, custom(), g2] });
    const r = playable(d, allowedAt(5));
    expect(r.kinds.permitting).toEqual([a, b, c]);
    expect(r.kinds.money).toEqual([g1, g2]);
  });

  it('at level 5 drops custom money and keeps given', () => {
    const g = given();
    const d = doc({ money: [custom(), g] });
    expect(playable(d, allowedAt(5)).kinds.money).toEqual([g]);
  });
});

describe('levelNeeded, simLocked, needsHigher', () => {
  it('follows the table', () => {
    expect(levelNeeded(doc({}))).toBe(2);
    expect(levelNeeded(doc({ permitting: [permit()] }))).toBe(3);
    expect(levelNeeded(doc({ permitting: [permit(false)] }))).toBe(3);
    expect(levelNeeded(doc({ zoning: [zone()] }))).toBe(4);
    expect(levelNeeded(doc({ zoning: [zone()], permitting: [permit()] }))).toBe(4);
    expect(levelNeeded(doc({ money: [given()] }))).toBe(5);
    expect(levelNeeded(doc({ money: [given(), custom()] }))).toBe(6);
    expect(levelNeeded(doc({ permitting: [permit()], money: [custom()] }))).toBe(6);
  });

  it('a string preset on a selector that is not a money one is not given', () => {
    const odd = pol({ tag: 'painted' }, 'housing-bond');
    const d = doc({ money: [odd] });
    expect(isGiven(odd)).toBe(false);
    expect(levelNeeded(d)).toBe(6);
    expect(needsHigher(d, lv(5))).toBe(6);
    expect(playable(d, allowedAt(5)).kinds.money).toEqual([]);
  });

  it('simLocked', () => {
    expect(simLocked(lv(1))).toBe(true);
    for (const l of [2, 3, 4, 5] as Level[]) expect(simLocked(lv(l))).toBe(false);
  });

  it('needsHigher', () => {
    expect(needsHigher(doc({}), lv(1))).toBe(2);
    expect(needsHigher(doc({}), lv(2))).toBeNull();
    expect(needsHigher(doc({ zoning: [zone()] }), lv(3))).toBe(4);
    expect(needsHigher(doc({ zoning: [zone()] }), lv(4))).toBeNull();
    expect(needsHigher(doc({ money: [custom()] }), lv(5))).toBe(6);
  });
});
