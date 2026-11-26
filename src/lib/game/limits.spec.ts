import { describe, expect, it } from 'vitest';
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import type { TimerEdit } from '$lib/sim/levers/types';
import { DEFAULT_BANDS, type TransitBand } from '$lib/sim-page/policy';
import { PRESETS, type PresetId, type TimingSet } from '$lib/sim-page/timing';
import { NEW_BAND_STEP_M } from '$lib/sim-page/transit-edit';
import type { Policy, PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import type { Pathway } from '$lib/timelapse/types';
import { RUNGS } from './ladder';
import {
  BASE_HANDS,
  FREE_MEASURES,
  FUNDING_PRESET_IDS,
  isGiven,
  limitsOf,
  OPEN_LIMITS,
  runnable,
  START_BANDS,
  START_REACH_M,
  START_STORIES,
  within,
  type Limits
} from './limits';
import { NEW_GAME, type GameState, type MetRung } from './state';
import type { Grant, TreeNode } from './tree';

function node(id: string, ...grants: Grant[]): TreeNode {
  return {
    id,
    branch: 'zoning',
    label: id,
    line: '',
    after: [],
    ring: 0,
    levels: grants.map((grant) => ({ price: { home: 1 }, grant, step: '' })),
    source: null
  };
}

function met(rung: number): MetRung {
  return { rung, reachedOn: 0, datasetVersion: 'fixture-0', at: '2026-11-25T00:00:00.000Z' };
}

function owned(bought: Record<string, number>, metRungs: MetRung[] = []): GameState {
  return { ...NEW_GAME, bought, met: metRungs };
}

function transit(stopTypes: StopType[], bands: TransitBand[]): Policy {
  return {
    id: 'z1',
    label: 'Transit',
    preset: null,
    on: true,
    where: { tag: 'transit', stopTypes },
    spans: [{ from: 0, to: null, what: { tag: 'bands', bands } }]
  };
}

function painted(): Policy {
  return {
    id: 'z2',
    label: 'Painted',
    preset: null,
    on: true,
    where: { tag: 'painted' },
    spans: [{ from: 0, to: null, what: { tag: 'brushes', brushes: [] } }]
  };
}

function protection(): Policy {
  return {
    id: 'z3',
    label: 'Rent control',
    preset: null,
    on: true,
    where: { tag: 'category', category: 'rentControl' },
    spans: [{ from: 0, to: null, what: { tag: 'protect', years: null } }]
  };
}

function permit(
  preset: PresetId,
  edits: TimerEdit[] = [],
  routeShares: Record<Pathway, number> | null = null
): Policy {
  const set: TimingSet = {
    preset,
    presetTimers: [],
    presetRouteShares: null,
    edits,
    routeShares,
    localProgramStreamlined: false
  };
  return {
    id: 'p1',
    label: 'Permitting',
    preset,
    on: true,
    where: { tag: 'routes' },
    spans: [{ from: 0, to: null, what: { tag: 'timing', set } }]
  };
}

function money(tag: 'fund' | 'baseline' | 'terms', preset: string | null): Policy {
  const base = { id: 'm1', label: 'Money', preset, on: true };
  if (tag === 'fund') {
    return {
      ...base,
      where: { tag: 'fund', pool: 'u-pool' },
      spans: [{ from: 0, to: null, what: { tag: 'fund', pool: null, programmes: [] } }]
    };
  }
  if (tag === 'baseline') {
    return {
      ...base,
      where: { tag: 'baseline' },
      spans: [{ from: 0, to: null, what: { tag: 'scales', entries: [] } }]
    };
  }
  return {
    ...base,
    where: { tag: 'terms' },
    spans: [{ from: 0, to: null, what: { tag: 'terms', terms: {} } }]
  };
}

const L: Limits = {
  open: false,
  presets: new Set(['sb423Clock']),
  measures: new Set(['housing-bond']),
  stops: new Set(['metro']),
  bands: 2,
  stories: 8,
  reachM: 805,
  custom: false,
  hands: BASE_HANDS
};

const NONE = limitsOf(NEW_GAME, []);

const EMPTY: Limits = {
  open: false,
  presets: new Set(),
  measures: new Set(),
  stops: new Set(),
  bands: 0,
  stories: 0,
  reachM: 0,
  custom: false,
  hands: BASE_HANDS
};

const EDIT: TimerEdit = { pathway: 'streamlined', stage: 'filed', scale: 0.5, reach: 'all' };
const SHARES: Record<Pathway, number> = { discretionary: 50, streamlined: 50, permitOnly: 0 };

describe('limitsOf', () => {
  const nodes = [node('z', { tag: 'stop', stop: 'metro' }, { tag: 'stories', max: 8 })];

  it('gives nothing for a new game', () => {
    expect(limitsOf(NEW_GAME, nodes)).toEqual(EMPTY);
    expect(NONE).toEqual(EMPTY);
  });

  it('starts transit limits at the first stop type', () => {
    const l = limitsOf(owned({ s: 1 }), [node('s', { tag: 'stop', stop: 'metro' })]);
    expect([l.bands, l.stories, l.reachM]).toEqual([1, 4, 402]);
    expect(l.stops).toEqual(new Set(['metro']));
    expect(START_STORIES).toBe(Math.min(...DEFAULT_BANDS.map((b) => b.stories)));
    expect(START_REACH_M).toBe(NEW_BAND_STEP_M);
    expect(START_BANDS).toBe(1);
  });

  it('holds transit limits at 0 with no stop type', () => {
    const l = limitsOf(owned({ a: 1, b: 1, c: 1 }), [
      node('a', { tag: 'stories', max: 8 }),
      node('b', { tag: 'reach', maxM: 805 }),
      node('c', { tag: 'bands', max: 2 })
    ]);
    expect([l.bands, l.stories, l.reachM]).toEqual([0, 0, 0]);
  });

  it('folds every level and takes the largest', () => {
    const fold = [
      node('z', { tag: 'stop', stop: 'metro' }, { tag: 'stories', max: 8 }),
      node('t', { tag: 'stories', max: 12 }, { tag: 'stories', max: 10 }),
      node('r', { tag: 'reach', maxM: 805 }, { tag: 'reach', maxM: 1609 }),
      node('b', { tag: 'bands', max: 2 }, { tag: 'bands', max: 3 }),
      node(
        'h',
        { tag: 'hands', what: 'radius', value: 64 },
        { tag: 'hands', what: 'radius', value: 56 },
        { tag: 'hands', what: 'linger', value: 6000 },
        { tag: 'hands', what: 'linger', value: 5000 },
        { tag: 'hands', what: 'auto' }
      )
    ];
    const l = limitsOf(owned({ z: 2, t: 2, r: 2, b: 2, h: 5 }), fold);
    expect(l.stories).toBe(12);
    expect(l.reachM).toBe(1609);
    expect(l.bands).toBe(3);
    expect(l.hands).toEqual({ radiusPx: 64, lingerMs: 6000, auto: true });
  });

  it("holds grants to the editor's bounds", () => {
    const l = limitsOf(owned({ s: 1, t: 1, r: 1, b: 1 }), [
      node('s', { tag: 'stop', stop: 'metro' }),
      node('t', { tag: 'stories', max: 100 }),
      node('r', { tag: 'reach', maxM: 5000 }),
      node('b', { tag: 'bands', max: 3 })
    ]);
    expect([l.stories, l.reachM, l.bands]).toEqual([80, 3219, 3]);
  });

  it('counts a level past the last as the last, and an unknown node as nothing', () => {
    const l = limitsOf(owned({ z: 5 }), nodes);
    expect(l.stops).toEqual(new Set(['metro']));
    expect(l.stories).toBe(8);
    expect(limitsOf(owned({ nope: 1 }), nodes)).toEqual(limitsOf(NEW_GAME, nodes));
  });

  it('opens transit and custom timing once finished, and leaves bought sets as bought', () => {
    const l = limitsOf(owned({ p: 1, m: 1 }, [met(RUNGS - 1)]), [
      node('p', { tag: 'preset', preset: 'sb423Clock' }),
      node('m', { tag: 'measure', preset: 'housing-bond' })
    ]);
    expect([l.stories, l.bands, l.reachM]).toEqual([80, 3, 3219]);
    expect(l.stops).toEqual(new Set(STOP_TYPES));
    expect(l.custom).toBe(true);
    expect(l.presets).toEqual(new Set(['sb423Clock', 'observed']));
    expect(l.measures).toEqual(new Set(['housing-bond']));
  });

  it('never lowers hands below the base', () => {
    const l = limitsOf(owned({ h: 2 }), [
      node(
        'h',
        { tag: 'hands', what: 'radius', value: 10 },
        { tag: 'hands', what: 'linger', value: 1000 }
      )
    ]);
    expect(l.hands).toEqual(BASE_HANDS);
  });
});

describe('constants', () => {
  it('has the base hands and free measures, frozen', () => {
    expect(BASE_HANDS).toEqual({ radiusPx: 48, lingerMs: 4000, auto: false });
    expect(Object.isFrozen(BASE_HANDS)).toBe(true);
    expect(Object.isFrozen(OPEN_LIMITS)).toBe(true);
    expect(Object.isFrozen(FREE_MEASURES)).toBe(true);
    expect(Object.isFrozen(FUNDING_PRESET_IDS)).toBe(true);
    expect(FREE_MEASURES).toEqual(['state-off', 'federal-credits-off']);
  });

  it('opens everything in OPEN_LIMITS', () => {
    expect(OPEN_LIMITS.open).toBe(true);
    expect(OPEN_LIMITS.presets).toEqual(new Set(PRESETS.map((p) => p.id)));
    expect(OPEN_LIMITS.measures).toEqual(new Set(FUNDING_PRESET_IDS));
    expect(OPEN_LIMITS.measures.size).toBe(11);
    expect(OPEN_LIMITS.stops).toEqual(new Set(STOP_TYPES));
    expect([OPEN_LIMITS.bands, OPEN_LIMITS.stories, OPEN_LIMITS.reachM]).toEqual([3, 80, 3219]);
    expect(OPEN_LIMITS.custom).toBe(true);
    expect(OPEN_LIMITS.hands).toBe(BASE_HANDS);
  });
});

interface Row {
  name: string;
  kind: PolicyKind;
  p: Policy;
  l: Limits;
  want: boolean;
}

const finishedLimits = (): Limits => limitsOf(owned({}, [met(RUNGS - 1)]), []);

const ROWS: Row[] = [
  { name: 'painted', kind: 'zoning', p: painted(), l: L, want: false },
  { name: 'protection, no stop type', kind: 'zoning', p: protection(), l: NONE, want: false },
  { name: 'protection, a stop type', kind: 'zoning', p: protection(), l: L, want: true },
  {
    name: 'transit at each limit exactly',
    kind: 'zoning',
    p: transit(
      ['metro'],
      [
        { maxM: 402, stories: 6 },
        { maxM: 805, stories: 8 }
      ]
    ),
    l: L,
    want: true
  },
  {
    name: 'transit, stop type not bought',
    kind: 'zoning',
    p: transit(['regionalRail'], [{ maxM: 402, stories: 4 }]),
    l: L,
    want: false
  },
  {
    name: 'transit, three bands',
    kind: 'zoning',
    p: transit(
      ['metro'],
      [
        { maxM: 402, stories: 4 },
        { maxM: 603, stories: 4 },
        { maxM: 805, stories: 4 }
      ]
    ),
    l: L,
    want: false
  },
  {
    name: 'transit, one story too tall',
    kind: 'zoning',
    p: transit(['metro'], [{ maxM: 402, stories: 9 }]),
    l: L,
    want: false
  },
  {
    name: 'transit, one metre too far',
    kind: 'zoning',
    p: transit(['metro'], [{ maxM: 806, stories: 4 }]),
    l: L,
    want: false
  },
  { name: 'transit, nothing bought', kind: 'zoning', p: transit([], []), l: NONE, want: false },
  {
    name: 'permit not bought',
    kind: 'permitting',
    p: permit('noDiscretionary'),
    l: L,
    want: false
  },
  { name: 'permit bought', kind: 'permitting', p: permit('sb423Clock'), l: L, want: true },
  {
    name: 'permit, timer edit',
    kind: 'permitting',
    p: permit('sb423Clock', [EDIT]),
    l: L,
    want: false
  },
  {
    name: 'permit, route shares',
    kind: 'permitting',
    p: permit('sb423Clock', [], SHARES),
    l: L,
    want: false
  },
  {
    name: 'permit, timer edit, custom',
    kind: 'permitting',
    p: permit('sb423Clock', [EDIT]),
    l: { ...L, custom: true },
    want: true
  },
  {
    name: 'permit, route shares, custom',
    kind: 'permitting',
    p: permit('sb423Clock', [], SHARES),
    l: { ...L, custom: true },
    want: true
  },
  { name: 'custom timing, playing', kind: 'permitting', p: permit('observed'), l: L, want: false },
  {
    name: 'custom timing, finished',
    kind: 'permitting',
    p: permit('observed'),
    l: finishedLimits(),
    want: true
  },
  {
    name: 'permit, null preset',
    kind: 'permitting',
    p: { ...permit('sb423Clock'), preset: null },
    l: L,
    want: false
  },
  {
    name: 'permit, null preset, custom',
    kind: 'permitting',
    p: { ...permit('sb423Clock'), preset: null },
    l: { ...L, custom: true },
    want: false
  },
  { name: 'money bought', kind: 'money', p: money('fund', 'housing-bond'), l: L, want: true },
  {
    name: 'free measure, nothing bought',
    kind: 'money',
    p: money('fund', 'state-off'),
    l: { ...L, measures: new Set() },
    want: false
  },
  {
    name: 'free measure, one bought',
    kind: 'money',
    p: money('fund', 'state-off'),
    l: L,
    want: true
  },
  { name: 'fund, null preset', kind: 'money', p: money('fund', null), l: L, want: false },
  { name: 'City funding scale', kind: 'money', p: money('baseline', null), l: L, want: false },
  { name: 'market terms', kind: 'money', p: money('terms', null), l: L, want: false }
];

describe('within', () => {
  it.each(ROWS)('$name', ({ kind, p, l, want }) => {
    expect(within(kind, p, l)).toBe(want);
  });

  it.each(ROWS)('$name: the same answer on and off', ({ kind, p, l, want }) => {
    expect(within(kind, { ...p, on: !p.on }, l)).toBe(want);
  });

  it.each(ROWS)('$name: true on OPEN_LIMITS', ({ kind, p }) => {
    expect(within(kind, p, OPEN_LIMITS)).toBe(true);
  });

  it('refuses a selector that does not belong to the kind', () => {
    expect(within('permitting', transit(['metro'], []), L)).toBe(false);
    expect(within('zoning', permit('sb423Clock'), L)).toBe(false);
  });
});

describe('runnable', () => {
  const ok1 = { ...protection(), id: 'ok1' };
  const ok2 = { ...transit(['metro'], [{ maxM: 402, stories: 4 }]), id: 'ok2' };
  const doc = (zoning: Policy[]): SimPolicy4 => ({
    schema: 4,
    kinds: { zoning, permitting: [permit('sb423Clock')], money: [money('fund', 'housing-bond')] }
  });

  it('returns the same document when everything is within', () => {
    const d = doc([ok1, ok2]);
    expect(runnable(d, L)).toBe(d);
  });

  it('drops what is outside and keeps order', () => {
    const d = doc([ok1, painted(), ok2]);
    const r = runnable(d, L);
    expect(r.kinds.zoning).toEqual([ok1, ok2]);
    expect(r.kinds.permitting).toBe(d.kinds.permitting);
    expect(r.kinds.money).toBe(d.kinds.money);
  });

  it('returns the document on OPEN_LIMITS', () => {
    const d = doc([ok1, painted(), ok2]);
    expect(runnable(d, OPEN_LIMITS)).toBe(d);
  });
});

describe('isGiven', () => {
  const route = (tag: 'routes' | 'transit', preset: string): Policy => ({
    ...(tag === 'routes' ? permit('sb423Clock') : transit(['metro'], [])),
    preset
  });

  it.each([
    { name: 'fund with a preset', p: money('fund', 'housing-bond'), want: true },
    { name: 'baseline with a preset', p: money('baseline', 'state-off'), want: true },
    { name: 'terms with a preset', p: money('terms', 'x'), want: true },
    { name: 'fund with no preset', p: money('fund', null), want: false },
    { name: 'routes with a preset', p: route('routes', 'sb423Clock'), want: false },
    { name: 'transit with a preset', p: route('transit', 'x'), want: false }
  ])('$name', ({ p, want }) => {
    expect(isGiven(p)).toBe(want);
  });
});
