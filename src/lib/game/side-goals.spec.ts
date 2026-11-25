import { describe, expect, it } from 'vitest';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { RunTake } from './run-result';
import { SIDE_GOALS, SIDE_SHOWN, sideGoals, sideShown } from './side-goals';
import { SIDE_TUNING } from './catalogue/tuning';
import { NEW_GAME, type GameState, type Units } from './state';

const TUNING = {
  'policy-homes-1': { target: 1000, reward: { home: 500 } },
  'collect-share-1': { target: 50, reward: { home: 300 } },
  'approved-homes': { target: 2000, reward: { home: 400 } },
  'collect-run': { target: 10000, reward: { home: 500 } },
  'policy-homes-2': { target: 10000, reward: { home: 1000 } },
  'new-money': { target: 100, reward: { home: 800 } },
  'funded-homes': { target: 15000, reward: { home: 800 } },
  'collect-share-2': { target: 90, reward: { home: 600 } },
  'building-homes': { target: 10000, reward: { home: 800 } },
  'affordable-homes': { target: 20000, reward: { home: 1200 } },
  'policy-homes-3': { target: 25000, reward: { home: 1500 } }
};

const goals = sideGoals(TUNING);
const byId = (id: string) => {
  const g = goals.find((x) => x.id === id);
  if (g === undefined) throw new Error(`no goal ${id}`);
  return g;
};

interface ViewOpts {
  filledThrough?: number;
  compare?: string;
  completed?: number;
  entitled?: number;
  pools?: { id: string; spent: number[] }[] | null;
  fundedHomes?: number[];
  construction?: number;
  tiers?: Record<string, number>[] | null;
}

function view(o: ViewOpts = {}): TimelineView {
  const money =
    o.pools === null || (o.pools === undefined && o.fundedHomes === undefined)
      ? null
      : { pools: o.pools ?? [], fundedHomes: o.fundedHomes ?? [] };
  return {
    filledThrough: o.filledThrough ?? 2,
    compare: o.compare ?? 'current',
    planEffect: [{}, {}, { completedNetNew: o.completed ?? 0, entitledNew: o.entitled ?? 0 }],
    rows: [{}, {}, { inProgress: { construction: o.construction ?? 0 } }],
    money,
    tiers: o.tiers === undefined ? null : o.tiers
  } as unknown as TimelineView;
}

const take = (dropped: Units, collected: Units): RunTake => ({ dropped, collected });
const none = take({}, {});
const read = (id: string, v: TimelineView, t: RunTake = none, index = 2) =>
  byId(id).read({ view: v, index, take: t });

const state = (rung: number, side: string[] = []): GameState => ({
  ...NEW_GAME,
  rung,
  side: Object.fromEntries(side.map((id) => [id, 'x']))
});

describe('side goals', () => {
  it('has eleven goals in order, with rings', () => {
    expect(goals.map((g) => g.id)).toEqual([
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
    expect(new Set(goals.map((g) => g.id)).size).toBe(11);
    expect(goals.map((g) => g.ring)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2]);
  });

  it('labels carry the formatted target', () => {
    expect(goals.map((g) => g.label)).toEqual([
      '1,000 homes from your policy',
      'Collect 50% of the homes in a run',
      '2,000 more homes approved',
      'Collect 10,000 homes in a run',
      '10,000 homes from your policy',
      '$100 million of new money granted',
      '15,000 homes built with public money',
      'Collect 90% of the homes in a run',
      '10,000 homes being built at once',
      '20,000 affordable homes built',
      '25,000 homes from your policy'
    ]);
  });

  it('leaves out goals without tuning and ignores extra tuning', () => {
    const g = sideGoals({
      'collect-run': { target: 7, reward: { home: 9 } },
      nope: { target: 1, reward: {} }
    });
    expect(g.map((x) => x.id)).toEqual(['collect-run']);
    expect(g[0].reward).toEqual({ home: 9 });
    expect(g[0].label).toBe('Collect 7 homes in a run');
    expect(g[0].read({ view: view(), index: 2, take: take({}, { home: 7 }) })).toEqual({
      value: 7,
      target: 7
    });
  });

  it('policy-homes-1 reads completed net new', () => {
    expect(read('policy-homes-1', view({ completed: 1200 }))).toEqual({
      value: 1200,
      target: 1000
    });
    expect(read('policy-homes-1', view({ completed: 1200 }), none, 3)).toBeNull();
    expect(read('policy-homes-1', view({ completed: 1200 }), none, -1)).toBeNull();
    expect(read('policy-homes-1', view({ completed: 1200, compare: 'preFzp' }))).toEqual({
      value: 0,
      target: 1000
    });
  });

  it('approved-homes reads entitled new', () => {
    expect(read('approved-homes', view({ entitled: 2500 }))).toEqual({
      value: 2500,
      target: 2000
    });
    expect(read('approved-homes', view({ entitled: 2500 }), none, 3)).toBeNull();
    expect(read('approved-homes', view({ entitled: 2500 }), none, -1)).toBeNull();
    expect(read('approved-homes', view({ entitled: 2500, compare: 'preFzp' }))?.value).toBe(0);
  });

  it('collect-share-1 reads the percent collected', () => {
    expect(read('collect-share-1', view(), take({ home: 200 }, { home: 101 }))).toEqual({
      value: 50,
      target: 50
    });
    expect(read('collect-share-1', view(), take({}, { home: 5 }))).toBeNull();
  });

  it('collect-run reads homes collected', () => {
    expect(read('collect-run', view(), take({ home: 20000 }, { home: 10000 }))?.value).toBe(10000);
    expect(read('collect-run', view(), take({}, { home: 10000 }))?.value).toBe(10000);
  });

  it('new-money sums the added pools in millions', () => {
    const v = view({
      pools: [
        { id: 'u-housing-bond-1', spent: [0, 0, 150_500_000] },
        { id: 'city', spent: [0, 0, 9e9] }
      ]
    });
    expect(read('new-money', v)).toEqual({ value: 150, target: 100 });
    expect(read('new-money', view({ pools: null }))).toBeNull();
    expect(read('new-money', v, none, 3)).toBeNull();
  });

  it('funded-homes reads funded homes', () => {
    expect(read('funded-homes', view({ pools: [], fundedHomes: [0, 0, 16000] }))?.value).toBe(
      16000
    );
    expect(read('funded-homes', view({ pools: null }))).toBeNull();
  });

  it('building-homes reads construction', () => {
    expect(read('building-homes', view({ construction: 12000 }))?.value).toBe(12000);
    expect(read('building-homes', view({ construction: 12000 }), none, 3)).toBeNull();
  });

  it('affordable-homes sums the affordable tiers', () => {
    const v = view({
      tiers: [{}, {}, { veryLow: 1, low: 2, moderate: 3, aboveModerate: 100, unrecorded: 4 }]
    });
    expect(read('affordable-homes', v)?.value).toBe(10);
    expect(read('affordable-homes', view({ tiers: null }))).toBeNull();
  });

  describe('sideShown', () => {
    const ids = (s: GameState) => sideShown(s, goals).map((g) => g.id);
    const ring0 = ['policy-homes-1', 'collect-share-1', 'approved-homes', 'collect-run'];

    it('shows the first three open goals', () => {
      expect(ids(state(0))).toEqual(['policy-homes-1', 'collect-share-1', 'approved-homes']);
      expect(ids(state(0, ['policy-homes-1']))).toEqual([
        'collect-share-1',
        'approved-homes',
        'collect-run'
      ]);
    });

    it('shows none when the ring is done, and opens the next ring by rung', () => {
      expect(ids(state(0, ring0))).toEqual([]);
      expect(ids(state(1, ring0))).toEqual(['policy-homes-2', 'new-money', 'funded-homes']);
      expect(ids(state(9))).toHaveLength(3);
    });
  });

  it('SIDE_SHOWN is 3 and SIDE_GOALS follows SIDE_TUNING', () => {
    expect(SIDE_SHOWN).toBe(3);
    expect(SIDE_GOALS.map((g) => g.id)).toEqual(sideGoals(SIDE_TUNING).map((g) => g.id));
  });
});
