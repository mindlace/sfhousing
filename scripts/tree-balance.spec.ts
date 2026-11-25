import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NODES } from '../src/lib/game/catalogue/nodes';
import { RUNGS } from '../src/lib/game/ladder';
import { SIDE_GOALS, type SideGoal } from '../src/lib/game/side-goals';
import { NEW_GAME, type GameState } from '../src/lib/game/state';
import type { Branch, NodeLevel, TreeNode } from '../src/lib/game/tree';
import { openEngine, type Engine } from './reach-measure';
import {
  CLOCK,
  checksOf,
  clockOf,
  currentLaw,
  leftToBuy,
  nextBuy,
  ORDERS,
  play,
  playWithEvents,
  raiseTo,
  sequenceOf,
  shareOf,
  sideReport,
  type PlayEvent,
  type PlayReport
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

const FIXTURE = 'e2e/fixtures/data/fixture-0';
/** Enough for the fixture's fills of every play below; a hook argument, not a wait. */
const FILL_HOOK_MS = 600_000;
const FAR = 10_000_000;

const priced = (home: number): TreeNode[] =>
  NODES.map((n) => ({ ...n, levels: n.levels.map((l) => ({ ...l, price: { home } })) }));
const ONE = priced(1);
const DEAR = priced(FAR);

const boughtOf = (r: PlayReport) => r.runs.flatMap((x) => x.bought);
const pairs = (nodes: readonly TreeNode[]) =>
  nodes.flatMap((n) => n.levels.map((_, k) => `${n.id} ${k + 1}`)).sort();

describe('play on the fixture', () => {
  let engine: Engine;
  let finishing: PlayReport;
  let finishingEvents: PlayEvent[];
  let forMe: PlayReport;
  let stuck: PlayReport;
  let tooLong: PlayReport;
  const eventsBy = new Map<PlayReport, PlayEvent[]>();

  beforeAll(async () => {
    engine = await openEngine({ dir: FIXTURE });
    const played = async (amount: number, nodes: TreeNode[], mode: 'hand' | 'collect-for-me') => {
      const { report, events } = await playWithEvents(engine, 'catalogue', mode, {
        amount,
        nodes
      });
      eventsBy.set(report, events);
      return report;
    };
    finishing = await played(1, ONE, 'hand');
    finishingEvents = eventsBy.get(finishing)!;
    forMe = await played(1, ONE, 'collect-for-me');
    stuck = await played(FAR, ONE, 'hand');
    tooLong = await played(FAR, DEAR, 'hand');
  }, FILL_HOOK_MS);

  afterAll(() => {
    engine?.close();
  });

  it('a play on the fixture with 1-unit prices and a small amount finishes and buys every level', () => {
    expect(finishing.end).toBe('finished');
    expect(finishing.order).toBe('catalogue');
    expect(finishing.mode).toBe('hand');
    const got = boughtOf(finishing)
      .map((b) => `${b.id} ${b.level}`)
      .sort();
    expect(got).toEqual(pairs(ONE));
    expect(boughtOf(finishing).every((b) => b.price === 1)).toBe(true);
    expect(finishing.runs.at(-1)?.rung).toBe(RUNGS - 1);
  });

  it('a play whose goal no document reaches ends stuck at rung 0 with everything bought', () => {
    expect(stuck.end).toBe('stuck');
    expect(stuck.runs.at(-1)?.rung).toBe(0);
    const shown = ONE.filter((n) => n.ring === 0);
    const got = boughtOf(stuck)
      .map((b) => `${b.id} ${b.level}`)
      .sort();
    expect(got).toEqual(pairs(shown));
    expect(stuck.runs.slice(-3).every((r) => r.bought.length === 0)).toBe(true);
    expect(stuck.runs.every((r) => r.reachedOn === null && r.lump === 0)).toBe(true);
  });

  it('a play that cannot afford its next level ends too-long at 300 runs', () => {
    expect(tooLong.end).toBe('too-long');
    expect(tooLong.runs).toHaveLength(300);
    expect(boughtOf(tooLong)).toEqual([]);
    expect(tooLong.runs.map((r) => r.n)).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
  });

  it('collected is floor(share × dropped) and the clock counts every run and purchase', () => {
    const first = finishing.runs[0]!;
    expect(first.dropped).toBeGreaterThan(0);
    expect(first.collected).toBe(Math.floor(0.25 * first.dropped));
    const mine = forMe.runs[0]!;
    expect(mine.collected).toBe(mine.dropped);
    for (const r of [finishing, forMe, stuck, tooLong]) {
      const buys = boughtOf(r).length;
      const events = eventsBy.get(r)!;
      expect(events.filter((e) => e.type === 'run')).toHaveLength(r.runs.length);
      expect(events.filter((e) => e.type === 'buy')).toHaveLength(buys);
      expect(r.clockS).toBe(clockOf(events));
      expect(r.clockS).toBe(60 + 28 * r.runs.length + 4 * buys);
      expect(r.checks).toEqual(checksOf(events));
    }
  });

  it('play returns the report playWithEvents gives', async () => {
    const r = await play(engine, 'catalogue', 'hand', { amount: FAR, nodes: DEAR });
    expect(r).toEqual(tooLong);
  });

  it('a bought entry has the spec shape', () => {
    for (const b of boughtOf(finishing)) {
      expect(Object.keys(b).sort()).toEqual(['id', 'level', 'price']);
    }
  });

  it('a run reports its lump apart from collected units', () => {
    const first = finishing.runs[0]!;
    expect(first.reachedOn).not.toBeNull();
    expect(first.lump).toBe(2000);
    expect(first.balance).toBe(first.collected + first.lump + first.sideRewards);
  });

  it('a hands purchase does not change the map', () => {
    const events = finishingEvents;
    const buys = events.filter((e) => e.type === 'buy');
    const entries = boughtOf(finishing);
    expect(buys).toHaveLength(entries.length);
    const at = (id: string) => entries.findIndex((b) => b.id === id && b.level === 1);
    expect(buys[at('hands-radius')]).toEqual({ type: 'buy', mapChange: false });
    expect(buys[at('stop-rail')]).toEqual({ type: 'buy', mapChange: true });
    expect(events.filter((e) => e.type === 'met')).toHaveLength(RUNGS);
  });

  it("current law reads each side goal at its rung's deadline, and null past the last rung", async () => {
    const atLaw = await currentLaw(engine);
    const rung0 = atLaw(0);
    expect(rung0).not.toBeNull();
    for (const g of SIDE_GOALS) {
      const v = rung0!(g);
      expect(v === null || typeof v === 'number').toBe(true);
    }
    expect(rung0!(SIDE_GOALS.find((g) => g.id === 'collect-run')!)).toEqual(expect.any(Number));
    expect(atLaw(RUNGS)).toBeNull();
    expect(atLaw(RUNGS + 3)).toBeNull();
    expect(atLaw(RUNGS - 1)).not.toBeNull();
  });
});
