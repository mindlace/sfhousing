import { describe, expect, it } from 'vitest';
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import type { TransitBand } from '$lib/sim-page/policy';
import type { PresetId, TimingSet } from '$lib/sim-page/timing';
import { kindOpen } from '$lib/timeline/add';
import type { Policy, PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import { POLICY_KEYS, ROUNDS } from './catalogue/rounds';
import {
  FREE_MEASURES,
  OPEN_LIMITS,
  canRemove,
  isFixed,
  isGiven,
  limitsOf,
  runnable,
  within
} from './limits';
import { NEW_GAME, type GameState } from './state';

const AT = '2026-11-26T00:00:00.000Z';
const game = (o: Partial<GameState> = {}): GameState => ({
  ...NEW_GAME,
  phase: 'runs',
  firstWinAt: AT,
  ...o
});

function transit(id: string, stopTypes: StopType[], bands: TransitBand[]): Policy {
  return {
    id,
    label: 'Transit',
    preset: null,
    on: true,
    where: { tag: 'transit', stopTypes },
    spans: [{ from: 0, to: null, what: { tag: 'bands', bands } }]
  };
}

function painted(): Policy {
  return {
    id: 'painted',
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

function permit(preset: PresetId | null): Policy {
  const set: TimingSet = {
    preset: preset ?? 'observed',
    presetTimers: [],
    presetRouteShares: null,
    edits: [],
    routeShares: null,
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

const RAIL = transit('transit-rail', ['regionalRail'], [{ maxM: 402, stories: 7 }]);
const METRO = transit('transit-metro', ['metro'], [{ maxM: 402, stories: 6 }]);
const GAME_TRANSIT = transit('game-transit', ['metro'], [{ maxM: 3219, stories: 40 }]);
const KINDS: readonly PolicyKind[] = ['zoning', 'permitting', 'money'];

const R0 = limitsOf(game({ round: 0 }));
const R1 = limitsOf(game({ round: 1 }));
const DONE = limitsOf(game({ round: ROUNDS, finished: true }));

describe('limitsOf', () => {
  it('round 0 offers nothing and no kind opens', () => {
    expect(R0).toMatchObject({ open: false, whole: false, own: false, money: false });
    expect(R0.offered.size).toBe(0);
    expect(R0.editable.size).toBe(0);
    expect(R0.stops.size).toBe(0);
    for (const kind of KINDS) expect(kindOpen(kind, R0)).toBe(false);
  });

  it("round 1 offers the round's three keys, regional rail and money", () => {
    expect(R1.offered).toEqual(new Set(['transit-rail', 'sb423-clock', 'housing-bond']));
    expect(R1.stops).toEqual(new Set(['regionalRail']));
    expect(R1.money).toBe(true);
    expect(R1.editable.size).toBe(0);
  });

  it('editable keys are offered and editable, whatever the round', () => {
    const l = limitsOf(game({ round: 1, editable: ['transit-metro'] }));
    expect(l.offered.has('transit-metro')).toBe(true);
    expect(l.editable).toEqual(new Set(['transit-metro']));
    expect(l.stops).toEqual(new Set(['regionalRail', 'metro']));
  });

  it('a finished game is whole: every key offered and editable, every stop type', () => {
    expect(DONE.whole).toBe(true);
    expect(DONE.offered).toEqual(new Set(POLICY_KEYS));
    expect(DONE.editable).toEqual(new Set(POLICY_KEYS));
    expect(DONE.stops).toEqual(new Set(STOP_TYPES));
  });

  it('own comes from the state', () => {
    expect(limitsOf(game({ own: true })).own).toBe(true);
  });
});

describe('OPEN_LIMITS', () => {
  it('is open, whole and own with everything', () => {
    expect(OPEN_LIMITS).toMatchObject({ open: true, whole: true, own: true, money: true });
    expect(OPEN_LIMITS.offered).toEqual(new Set(POLICY_KEYS));
    expect(OPEN_LIMITS.editable).toEqual(new Set(POLICY_KEYS));
    expect(OPEN_LIMITS.stops).toEqual(new Set(STOP_TYPES));
    expect(Object.isFrozen(OPEN_LIMITS)).toBe(true);
  });

  it('FREE_MEASURES is unchanged', () => {
    expect(FREE_MEASURES).toEqual(['state-off', 'federal-credits-off']);
  });
});

describe('within', () => {
  it('the round-1 transit policy at 3,219 m and 40 stories runs (any values)', () => {
    const far = transit('transit-rail', ['regionalRail'], [{ maxM: 3219, stories: 40 }]);
    expect(within('zoning', far, R1)).toBe(true);
  });

  it("a round-2 key's policy in a round-1 game does not run", () => {
    expect(within('zoning', METRO, R1)).toBe(false);
    expect(within('permitting', permit('benchmarkPermits'), R1)).toBe(false);
    expect(within('money', money('fund', 'general-revenue'), R1)).toBe(false);
  });

  it("the round's catalogue policies run", () => {
    expect(within('zoning', RAIL, R1)).toBe(true);
    expect(within('permitting', permit('sb423Clock'), R1)).toBe(true);
    expect(within('money', money('fund', 'housing-bond'), R1)).toBe(true);
  });

  it('game-transit runs when own, not otherwise', () => {
    expect(within('zoning', GAME_TRANSIT, R1)).toBe(false);
    expect(within('zoning', GAME_TRANSIT, { ...R1, own: true })).toBe(true);
    expect(within('zoning', GAME_TRANSIT, DONE)).toBe(true);
  });

  it('painted never runs in a game, even a finished one', () => {
    expect(within('zoning', painted(), R1)).toBe(false);
    expect(within('zoning', painted(), DONE)).toBe(false);
  });

  it('protections run once a stop type is offered', () => {
    expect(within('zoning', protection(), R0)).toBe(false);
    expect(within('zoning', protection(), R1)).toBe(true);
  });

  it('state-off runs once money is true', () => {
    expect(within('money', money('fund', 'state-off'), R0)).toBe(false);
    expect(within('money', money('fund', 'state-off'), R1)).toBe(true);
  });

  it('custom timing, own pools, scale and terms run only when whole', () => {
    for (const [kind, p] of [
      ['permitting', permit('observed')],
      ['permitting', permit(null)],
      ['money', money('fund', null)],
      ['money', money('baseline', null)],
      ['money', money('terms', null)]
    ] as const) {
      expect(within(kind, p, R1)).toBe(false);
      expect(within(kind, p, DONE)).toBe(true);
    }
  });

  it('refuses a selector that does not belong to the kind', () => {
    expect(within('permitting', RAIL, DONE)).toBe(false);
    expect(within('zoning', permit('sb423Clock'), DONE)).toBe(false);
  });

  it('everything runs on OPEN_LIMITS, on or off', () => {
    for (const [kind, p] of [
      ['zoning', painted()],
      ['zoning', GAME_TRANSIT],
      ['permitting', permit(null)],
      ['money', money('terms', null)]
    ] as const) {
      expect(within(kind, p, OPEN_LIMITS)).toBe(true);
      expect(within(kind, { ...p, on: false }, OPEN_LIMITS)).toBe(true);
    }
  });
});

describe('isFixed and canRemove', () => {
  it('isFixed: an offered key not yet editable', () => {
    expect(isFixed(RAIL, R1)).toBe(true);
    expect(isFixed(RAIL, limitsOf(game({ round: 1, editable: ['transit-rail'] })))).toBe(false);
    expect(isFixed(RAIL, DONE)).toBe(false);
    expect(isFixed(RAIL, OPEN_LIMITS)).toBe(false);
    expect(isFixed(GAME_TRANSIT, R1)).toBe(false);
  });

  it('canRemove: not a catalogue policy before the end', () => {
    expect(canRemove(RAIL, R1)).toBe(false);
    expect(canRemove(RAIL, limitsOf(game({ round: 1, editable: ['transit-rail'] })))).toBe(false);
    expect(canRemove(RAIL, DONE)).toBe(true);
    expect(canRemove(RAIL, OPEN_LIMITS)).toBe(true);
    expect(canRemove(GAME_TRANSIT, R1)).toBe(true);
  });
});

describe('runnable', () => {
  const doc = (zoning: Policy[]): SimPolicy4 => ({
    schema: 4,
    kinds: { zoning, permitting: [permit('sb423Clock')], money: [money('fund', 'housing-bond')] }
  });

  it('returns the same document when everything is within', () => {
    const d = doc([protection(), RAIL]);
    expect(runnable(d, R1)).toBe(d);
  });

  it('drops what is outside and keeps order', () => {
    const d = doc([protection(), painted(), RAIL, METRO]);
    const r = runnable(d, R1);
    expect(r.kinds.zoning).toEqual([protection(), RAIL]);
    expect(r.kinds.permitting).toBe(d.kinds.permitting);
    expect(r.kinds.money).toBe(d.kinds.money);
  });

  it('returns the document on OPEN_LIMITS', () => {
    const d = doc([painted(), METRO]);
    expect(runnable(d, OPEN_LIMITS)).toBe(d);
  });
});

describe('isGiven', () => {
  it.each([
    { name: 'fund with a preset', p: money('fund', 'housing-bond'), want: true },
    { name: 'baseline with a preset', p: money('baseline', 'state-off'), want: true },
    { name: 'terms with a preset', p: money('terms', 'x'), want: true },
    { name: 'fund with no preset', p: money('fund', null), want: false },
    { name: 'routes with a preset', p: permit('sb423Clock'), want: false },
    { name: 'transit with a preset', p: { ...RAIL, preset: 'x' }, want: false }
  ])('$name', ({ p, want }) => {
    expect(isGiven(p)).toBe(want);
  });
});
