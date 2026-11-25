import { describe, expect, it } from 'vitest';
import { NODES } from './catalogue/nodes';
import { NEW_GAME, type GameState } from './state';
import { buy, isShown, levelOf, treeView, type TreeNode } from './tree';

const FIXTURE: TreeNode[] = [
  {
    id: 'a',
    branch: 'zoning',
    label: 'A',
    line: 'a line',
    after: [],
    ring: 0,
    levels: [
      { price: { home: 10 }, grant: { tag: 'stories', max: 6 }, step: 'to six' },
      { price: { home: 20 }, grant: { tag: 'stories', max: 8 }, step: 'to eight' }
    ],
    source: null
  },
  {
    id: 'b',
    branch: 'permitting',
    label: 'B',
    line: 'b line',
    after: ['a'],
    ring: 0,
    levels: [{ price: { home: 5 }, grant: { tag: 'bands', max: 2 }, step: 'two bands' }],
    source: null
  },
  {
    id: 'c',
    branch: 'money',
    label: 'C',
    line: 'c line',
    after: ['a', 'x'],
    ring: 0,
    levels: [{ price: { home: 5 }, grant: { tag: 'reach', maxM: 400 }, step: 'reach' }],
    source: null
  },
  {
    id: 'd',
    branch: 'hands',
    label: 'D',
    line: 'd line',
    after: [],
    ring: 1,
    levels: [{ price: { home: 5 }, grant: { tag: 'hands', what: 'auto' }, step: 'auto' }],
    source: null
  }
];

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

function game(patch: Partial<GameState>): GameState {
  return { ...NEW_GAME, ...patch };
}

const ids = (views: { node: TreeNode }[]) => views.map((v) => v.node.id);
const A = FIXTURE[0];

describe('treeView', () => {
  it('shows only nodes whose ring is open and that follow nothing or a bought node', () => {
    expect(ids(treeView(NEW_GAME, FIXTURE))).toEqual(['a']);
    expect(ids(treeView(game({ bought: { a: 1 } }), FIXTURE))).toEqual(['a', 'b', 'c']);
    expect(ids(treeView(game({ bought: { a: 1 }, rung: 1 }), FIXTURE))).toEqual([
      'a',
      'b',
      'c',
      'd'
    ]);
  });

  it('shows a node with two after entries once either is bought', () => {
    expect(ids(treeView(game({ bought: { x: 1 } }), FIXTURE))).toEqual(['a', 'c']);
  });

  it('speaks of the next level: ready, short with shortBy, done with short null', () => {
    const ready = treeView(game({ units: { home: 10 } }), FIXTURE)[0];
    expect(ready).toMatchObject({ level: 0, state: 'ready', short: null });
    const short = treeView(game({ units: { home: 5 } }), FIXTURE)[0];
    expect(short).toMatchObject({ level: 0, state: 'short', short: { home: 5 } });
    const done = treeView(game({ bought: { a: 2 } }), FIXTURE)[0];
    expect(done).toMatchObject({ level: 2, state: 'done', short: null });
  });

  it('counts a saved level above the last as the last', () => {
    const s = game({ bought: { a: 9 } });
    expect(treeView(s, FIXTURE)[0]).toMatchObject({ level: 2, state: 'done' });
    expect(levelOf(s, A)).toBe(2);
  });
});

describe('isShown', () => {
  it('follows the ring and the after list', () => {
    expect(isShown(NEW_GAME, A)).toBe(true);
    expect(isShown(NEW_GAME, FIXTURE[1])).toBe(false);
    expect(isShown(game({ bought: { a: 1 } }), FIXTURE[3])).toBe(false);
  });
});

describe('buy', () => {
  it('refuses unknown, hidden, done and short, in that order', () => {
    expect(buy(NEW_GAME, 'zz', FIXTURE)).toEqual({ ok: false, reason: 'unknown' });
    expect(buy(NEW_GAME, 'd', FIXTURE)).toEqual({ ok: false, reason: 'hidden' });
    expect(buy(game({ bought: { a: 2 } }), 'a', FIXTURE)).toEqual({ ok: false, reason: 'done' });
    expect(buy(game({ units: { home: 5 } }), 'a', FIXTURE)).toEqual({
      ok: false,
      reason: 'short'
    });
    expect(buy(game({ bought: { a: 9 } }), 'a', FIXTURE)).toEqual({ ok: false, reason: 'done' });
  });

  it('spends the next price, records level + 1, returns its grant and changes nothing else', () => {
    const s = game({ units: { home: 25 } });
    expect(buy(s, 'a', FIXTURE)).toEqual({
      ok: true,
      state: { ...s, units: { home: 15 }, bought: { a: 1 } },
      grant: A.levels[0].grant
    });
  });

  it('buys levels in order', () => {
    const first = buy(game({ units: { home: 40 } }), 'a', FIXTURE);
    expect(first.ok && first.grant).toEqual({ tag: 'stories', max: 6 });
    if (!first.ok) return;
    const second = buy(first.state, 'a', FIXTURE);
    expect(second.ok && second.grant).toEqual({ tag: 'stories', max: 8 });
  });

  it('changes neither argument', () => {
    const s = deepFreeze(game({ units: { home: 25 }, bought: { x: 1 } }));
    const list = deepFreeze(structuredClone(FIXTURE));
    const before = structuredClone(s);
    expect(() => buy(s, 'a', list)).not.toThrow();
    expect(() => treeView(s, list)).not.toThrow();
    expect(s).toEqual(before);
    expect(list).toEqual(FIXTURE);
  });

  it('defaults nodes to NODES', () => {
    const s = game({ units: { home: 25 } });
    expect(treeView(s)).toEqual(treeView(s, NODES));
    const id = NODES[0]?.id ?? 'zz';
    expect(buy(s, id)).toEqual(buy(s, id, NODES));
  });
});

describe('the catalogue', () => {
  const rich = { home: 1_000_000 };

  it('a new game shows one node per branch at level 0', () => {
    const views = treeView(NEW_GAME);
    expect(ids(views)).toEqual(['sb423-clock', 'stop-rail', 'housing-bond', 'hands-radius']);
    expect(views.map((v) => v.level)).toEqual([0, 0, 0, 0]);
  });

  it('buying stop-rail shows stop-metro and taller-1, and reach-1 once its ring is open', () => {
    const ring = NODES.find((n) => n.id === 'reach-1')!.ring;
    const bought = buy(game({ units: rich, rung: Math.max(ring - 1, 0) }), 'stop-rail');
    if (!bought.ok) throw new Error('stop-rail refused');
    const shownAt = (rung: number) => ids(treeView({ ...bought.state, rung }));
    const before = shownAt(Math.max(ring - 1, 0));
    expect(before).toContain('stop-metro');
    expect(before).toContain('taller-1');
    if (ring > 0) expect(before).not.toContain('reach-1');
    expect(shownAt(ring)).toContain('reach-1');
  });

  it('public-bank shows after either general-revenue or revolving-fund', () => {
    const top = Math.max(...NODES.map((n) => n.ring));
    for (const id of ['general-revenue', 'revolving-fund']) {
      expect(ids(treeView(game({ rung: top, bought: { [id]: 1 } })))).toContain('public-bank');
    }
    expect(ids(treeView(game({ rung: top, bought: { 'housing-bond': 1 } })))).not.toContain(
      'public-bank'
    );
  });

  it('buying taller-1 twice grants 6 then 8 stories', () => {
    const base = game({ units: rich, bought: { 'stop-rail': 1 } });
    const first = buy(base, 'taller-1');
    expect(first.ok && first.grant).toEqual({ tag: 'stories', max: 6 });
    if (!first.ok) return;
    const second = buy(first.state, 'taller-1');
    expect(second.ok && second.grant).toEqual({ tag: 'stories', max: 8 });
  });
});
