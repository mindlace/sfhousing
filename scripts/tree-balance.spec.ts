import { describe, expect, it } from 'vitest';
import { NODES } from '../src/lib/game/catalogue/nodes';
import type { SideGoal } from '../src/lib/game/side-goals';
import { NEW_GAME, type GameState } from '../src/lib/game/state';
import type { Branch, NodeLevel, TreeNode } from '../src/lib/game/tree';
import {
  CLOCK,
  checksOf,
  clockOf,
  leftToBuy,
  nextBuy,
  ORDERS,
  raiseTo,
  sequenceOf,
  shareOf,
  sideReport,
  type PlayEvent
} from './tree-balance';

const state = (over: Partial<GameState> = {}): GameState => ({ ...NEW_GAME, ...over });

describe('shareOf', () => {
  it('is the base share for a new game', () => {
    expect(shareOf(NEW_GAME, 'hand')).toBe(0.25);
  });
  it('adds radius and linger levels', () => {
    const s = state({ bought: { 'hands-radius': 4, 'hands-linger': 3 } });
    expect(shareOf(s, 'hand')).toBeCloseTo(0.8);
  });
  it('is 1 with the auto collector', () => {
    expect(shareOf(state({ bought: { 'hands-auto': 1 } }), 'hand')).toBe(1);
  });
  it('is 1 when collecting for the player', () => {
    expect(shareOf(NEW_GAME, 'collect-for-me')).toBe(1);
  });
});

describe('sequences', () => {
  const levels = NODES.reduce((n, node) => n + node.levels.length, 0);
  const named = ORDERS.filter((o) => o !== 'cheapest' && o !== 'catalogue');

  it('catalogue is the plain catalogue order', () => {
    const plain = NODES.flatMap((n) => n.levels.map(() => n.id));
    expect(sequenceOf('catalogue')).toEqual(plain);
  });

  for (const order of named) {
    it(`${order} lists each node once per level, its branch first`, () => {
      const seq = sequenceOf(order as Exclude<typeof order, 'cheapest'>);
      expect(seq).toHaveLength(levels);
      for (const n of NODES) {
        expect(seq.filter((id) => id === n.id)).toHaveLength(n.levels.length);
      }
      const branch = order.replace(/-first$/, '') as Branch;
      const head = NODES.filter((n) => n.branch === branch).flatMap((n) =>
        n.levels.map(() => n.id)
      );
      expect(head.length).toBeGreaterThan(0);
      expect(seq.slice(0, head.length)).toEqual(head);
    });
  }
});

const level = (home: number): NodeLevel => ({
  price: { home },
  grant: { tag: 'stories', max: 5 },
  step: ''
});
const node = (id: string, prices: number[], after: string[] = []): TreeNode => ({
  id,
  branch: 'zoning',
  label: id,
  line: '',
  after,
  ring: 0,
  levels: prices.map(level),
  source: null
});

describe('nextBuy', () => {
  it('a hidden entry waits in place', () => {
    const nodes = [node('A', [1]), node('B', [1, 1], ['C']), node('C', [1, 1])];
    const s = state({ units: { home: 10 }, bought: { A: 1 } });
    const pending = ['A', 'B', 'C', 'C', 'B'];
    const got = nextBuy('catalogue', s, pending, nodes);
    expect(got?.id).toBe('C');
    expect(got?.pending).toEqual(['B', 'C', 'B']);
    const after = state({ units: { home: 10 }, bought: { A: 1, C: 1 } });
    expect(nextBuy('catalogue', after, got?.pending ?? [], nodes)?.id).toBe('B');
  });

  it('stops at the first unaffordable shown entry', () => {
    const nodes = [node('D', [50]), node('E', [1])];
    const s = state({ units: { home: 5 } });
    expect(nextBuy('catalogue', s, ['D', 'E'], nodes)).toBeNull();
  });

  it('cheapest picks the lowest ready price, earlier node on a tie', () => {
    const nodes = [node('P', [5]), node('Q', [3]), node('R', [3]), node('S', [99])];
    const s = state({ units: { home: 10 } });
    expect(nextBuy('cheapest', s, [], nodes)?.id).toBe('Q');
  });

  it('cheapest is null when none is ready', () => {
    const nodes = [node('P', [5])];
    expect(nextBuy('cheapest', state(), [], nodes)).toBeNull();
  });
});

describe('leftToBuy', () => {
  it('is false when every entry is done or not shown', () => {
    const nodes = [node('A', [1]), node('B', [1], ['Z'])];
    const s = state({ bought: { A: 1 } });
    expect(leftToBuy('catalogue', s, ['A', 'B'], nodes)).toBe(false);
    expect(leftToBuy('cheapest', s, [], nodes)).toBe(false);
  });
  it('is true when a shown node is not done', () => {
    const nodes = [node('A', [1]), node('B', [1])];
    expect(leftToBuy('catalogue', state(), ['A', 'B'], nodes)).toBe(true);
    expect(leftToBuy('cheapest', state(), [], nodes)).toBe(true);
  });
});

const run: PlayEvent = { type: 'run' };
const buy = (mapChange = true): PlayEvent => ({ type: 'buy', mapChange });
const met: PlayEvent = { type: 'met' };
const runs = (n: number): PlayEvent[] => Array.from({ length: n }, () => run);
const check = (events: PlayEvent[], id: string) => {
  const c = checksOf(events).find((x) => x.id === id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};

describe('clockOf', () => {
  it('adds the opening, each run and tally and each buy', () => {
    expect(CLOCK.openingS).toBe(60);
    expect(clockOf([run, buy(), run])).toBe(60 + 28 + 4 + 28);
  });
});

describe('checks at each edge', () => {
  it('lists every check in order', () => {
    expect(checksOf([]).map((c) => c.id)).toEqual([
      'first-purchase',
      'early-runs-per-purchase',
      'runs-per-purchase',
      'map-gap',
      'purchases-per-deadline'
    ]);
  });

  it('first purchase', () => {
    const ok = check([run, buy()], 'first-purchase');
    expect(ok.value).toBe(92);
    expect(ok.pass).toBe(true);
    const bad = check([...runs(3), buy()], 'first-purchase');
    expect(bad.value).toBe(148);
    expect(bad.pass).toBe(false);
    const none = check([run], 'first-purchase');
    expect(none.value).toBe(88);
    expect(none.pass).toBe(false);
  });

  it('early runs per purchase', () => {
    const ok = Array.from({ length: 5 }, () => [run, buy()]).flat();
    expect(check(ok, 'early-runs-per-purchase').pass).toBe(true);
    const bad = [run, buy(), run, run, buy()];
    const c = check(bad, 'early-runs-per-purchase');
    expect(c.value).toBe(2);
    expect(c.pass).toBe(false);
  });

  it('early runs ignore buys after the fifth', () => {
    const events = [...Array.from({ length: 5 }, () => [run, buy()]).flat(), run, run, buy()];
    expect(check(events, 'early-runs-per-purchase').pass).toBe(true);
    expect(check(events, 'runs-per-purchase').pass).toBe(true);
  });

  it('runs per purchase', () => {
    expect(check([...runs(3), buy()], 'runs-per-purchase').pass).toBe(true);
    const bad = check([...runs(4), buy()], 'runs-per-purchase');
    expect(bad.value).toBe(4);
    expect(bad.pass).toBe(false);
  });

  it('map gap', () => {
    const ok = check([buy(), ...runs(10), buy()], 'map-gap');
    expect(ok.value).toBe(284);
    expect(ok.pass).toBe(true);
    const bad = check([buy(), ...runs(11), buy()], 'map-gap');
    expect(bad.value).toBe(312);
    expect(bad.pass).toBe(false);
  });

  it('a hands buy does not reset the map gap', () => {
    const c = check([buy(), ...runs(5), buy(false), ...runs(5), buy()], 'map-gap');
    expect(c.value).toBe(10 * 28 + 8);
  });

  it('map gap is 0 with fewer than two map buys', () => {
    expect(check([buy(), run, buy(false)], 'map-gap').value).toBe(0);
    expect(check([buy(), run, buy(false)], 'map-gap').pass).toBe(true);
  });

  it('purchases per deadline', () => {
    const ok = check([met, buy(), buy(), buy(), met], 'purchases-per-deadline');
    expect(ok.value).toBe(3);
    expect(ok.pass).toBe(true);
    const bad = check([met, buy(), buy(), met], 'purchases-per-deadline');
    expect(bad.value).toBe(2);
    expect(bad.pass).toBe(false);
  });

  it('purchases per deadline passes with fewer than two met events', () => {
    const c = check([met, buy()], 'purchases-per-deadline');
    expect(c.value).toBe(0);
    expect(c.pass).toBe(true);
  });
});

describe('side report', () => {
  const goal = (id: string, ring = 1): SideGoal => ({
    id,
    label: id,
    ring,
    reward: {},
    read: () => null
  });
  const at = (value: number | null) => () => (value === null ? null : () => value);

  it('raiseTo rounds 1.25 times up to 1,000 and always rises', () => {
    expect(raiseTo(12_400)).toBe(16_000);
    expect(raiseTo(10_000)).toBe(13_000);
    expect(raiseTo(0)).toBe(1_000);
  });

  it('flags a target at or below current law', () => {
    const g = [goal('building-homes')];
    const r = sideReport(g, at(12_400), new Set(['building-homes']));
    expect(r[0]?.flags).toEqual(['at-or-below-current-law']);
    expect(r[0]?.raiseTo).toBe(16_000);
    expect(r[0]?.value).toBe(12_400);
    expect(r[0]?.rung).toBe(1);
  });

  it('flags equality and not a lower current law', () => {
    const g = [goal('collect-run', 0)];
    const target = sideReport(g, at(0), new Set(['collect-run']))[0]?.target ?? 0;
    expect(target).toBeGreaterThan(0);
    const eq = sideReport(g, at(target), new Set(['collect-run']));
    expect(eq[0]?.flags).toEqual(['at-or-below-current-law']);
    expect(eq[0]?.raiseTo).toBe(raiseTo(target));
    const below = sideReport(g, at(target - 1), new Set(['collect-run']));
    expect(below[0]?.flags).toEqual([]);
    expect(below[0]?.raiseTo).toBeNull();
  });

  it('flags a goal never met', () => {
    const r = sideReport([goal('collect-run', 0)], at(1), new Set());
    expect(r[0]?.flags).toEqual(['never-met']);
    expect(r[0]?.raiseTo).toBeNull();
  });

  it('leaves value null and unflagged for a rung the ladder lacks', () => {
    const r = sideReport([goal('collect-run', 0)], at(null), new Set(['collect-run']));
    expect(r[0]?.value).toBeNull();
    expect(r[0]?.flags).toEqual([]);
  });
});
