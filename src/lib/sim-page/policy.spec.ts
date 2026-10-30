import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS, parseSimLevers } from '$lib/sim/levers/types';
import { OBSERVED_TIMING, type TimingSet } from './timing';
import {
  DEFAULT_BANDS,
  PolicyFormatError,
  compileLevers,
  defaultEffect,
  lotRoles,
  parseSimPolicy,
  policyFromLevers,
  queriesOf,
  queryKey,
  scoreCopy,
  type SimPolicy,
  type Stroke,
  type ZoningBrush
} from './policy';

const stroke: Stroke = {
  path: [
    [-122.4, 37.7],
    [-122.41, 37.71]
  ],
  radiusM: 50
};
const base = (over: Partial<SimPolicy> = {}): SimPolicy => ({
  ...policyFromLevers(DEFAULT_LEVERS),
  ...over
});
const eff = (mode: 'raise' | 'lower' | 'set', stories = 6) => defaultEffect(mode, stories);
const freehand = (
  id: string,
  s: Stroke[],
  mode: 'raise' | 'lower' | 'set' = 'raise'
): ZoningBrush => ({
  id,
  kind: 'freehand',
  strokes: s,
  effect: eff(mode)
});
const s = (r: number): Stroke => ({ path: [[-122, 37]], radiusM: r });
const supply = (m: Map<string, string[]>) => (k: string) => m.get(k);

/** A custom set on a preset: benchmark-like preset timers, one edit and custom route shares. */
const CUSTOM: TimingSet = {
  preset: 'benchmarkPermits',
  presetTimers: [
    { pathway: 'discretionary', stage: 'permitFiled', scale: 0.4786, reach: 'all' },
    { pathway: 'streamlined', stage: 'filed', scale: 0.5, reach: 'new' }
  ],
  presetRouteShares: { discretionary: 0, streamlined: 67, permitOnly: 33 },
  edits: [{ pathway: 'discretionary', stage: 'filed', scale: 0.8, reach: 'all' }],
  routeShares: { discretionary: 10, streamlined: 60, permitOnly: 30 },
  localProgramStreamlined: true
};

describe('compileLevers', () => {
  it('round-trips the default and FZP levers', () => {
    for (const l of [DEFAULT_LEVERS, FZP_COMPAT_LEVERS])
      expect(compileLevers(policyFromLevers(l), () => undefined)).toEqual(l);
  });

  it('an empty brush compiles to no edit', () => {
    const p = base({
      brushes: [
        {
          id: 'a',
          kind: 'street',
          classes: ['major'],
          names: [],
          depth: 0,
          ncOnly: false,
          effect: eff('raise')
        }
      ]
    });
    const key = queriesOf(p)[0].key;
    const out = compileLevers(p, supply(new Map([[key, []]])));
    expect(out?.user).toEqual([]);
  });

  it('erase removes from earlier brushes only', () => {
    const a = freehand('a', [s(1)]);
    const e: ZoningBrush = { id: 'e', kind: 'erase', strokes: [s(2)] };
    const b = freehand('b', [s(3)], 'set');
    const p = base({ brushes: [a, e, b] });
    const m = new Map<string, string[]>([
      [queryKey({ kind: 'freehand', strokes: [s(1)] }), ['1', '2', '3']],
      [queryKey({ kind: 'freehand', strokes: [s(2)] }), ['2']],
      [queryKey({ kind: 'freehand', strokes: [s(3)] }), ['4', '2']]
    ]);
    const out = compileLevers(p, supply(m))!;
    expect(out.user.map((u) => u.lots)).toEqual([
      ['1', '3'],
      ['2', '4']
    ]);
    expect(out.user[1].mode).toBe('set');
    expect(() => parseSimLevers(out)).not.toThrow();
  });

  it('transit bands compile outermost first', () => {
    const p = base({
      brushes: [
        {
          id: 't',
          kind: 'transit',
          stopTypes: ['metro'],
          bands: DEFAULT_BANDS,
          mode: 'raise',
          densityLimits: false
        }
      ]
    });
    const keys = queriesOf(p).map((q) => q.key);
    expect(keys).toHaveLength(2);
    const m = new Map<string, string[]>([
      [queryKey({ kind: 'transit', stopTypes: ['metro'], maxM: 402 }), ['1']],
      [queryKey({ kind: 'transit', stopTypes: ['metro'], maxM: 805 }), ['1', '2']]
    ]);
    const out = compileLevers(p, supply(m))!;
    expect(out.user.map((u) => [u.stories, u.lots])).toEqual([
      [4, ['1', '2']],
      [6, ['1']]
    ]);
  });

  it('protection wins over a later raise, and unprotect removes', () => {
    const prot = { ...stroke, kind: 'protect' as const };
    const unprot = { ...s(9), kind: 'unprotect' as const };
    const p = base({
      brushes: [freehand('r', [s(5)])],
      protect: { ...base().protect, strokes: [prot, unprot] }
    });
    const pk = queryKey({ kind: 'freehand', strokes: [stroke] });
    const uk = queryKey({ kind: 'freehand', strokes: [s(9)] });
    const rk = queryKey({ kind: 'freehand', strokes: [s(5)] });
    const m = new Map<string, string[]>([
      [pk, ['5', '6']],
      [uk, ['6']],
      [rk, ['5']]
    ]);
    expect(compileLevers(p, supply(m))!.protect.lots).toEqual(['5']);
    expect(lotRoles(p, supply(m)).get('5')).toBe('protected');
    expect(lotRoles(p, supply(m)).has('6')).toBe(false);
  });

  it('returns null while a key is missing', () => {
    const p = base({ brushes: [freehand('a', [s(1)])] });
    expect(compileLevers(p, () => undefined)).toBeNull();
  });

  it('maps category protections and timing', () => {
    const l = {
      ...DEFAULT_LEVERS,
      protect: { ...DEFAULT_LEVERS.protect, historic: true, newerThanYears: 5 }
    };
    expect(compileLevers(policyFromLevers(l), () => undefined)).toEqual(l);
  });
});

describe('timing in the policy', () => {
  it('compiles preset timers then edits, and custom shares over the preset', () => {
    const l = compileLevers(base({ timing: { current: CUSTOM, saved: null } }), () => undefined)!;
    expect(l.timers).toEqual([...CUSTOM.presetTimers, ...CUSTOM.edits]);
    expect(l.routeShares).toEqual(CUSTOM.routeShares);
    const noCustom = { ...CUSTOM, routeShares: null };
    expect(
      compileLevers(base({ timing: { current: noCustom, saved: null } }), () => undefined)!
        .routeShares
    ).toEqual(CUSTOM.presetRouteShares);
  });

  it('policyFromLevers maps no timers to the observed set and refuses timers', () => {
    const p = policyFromLevers({ ...DEFAULT_LEVERS, localProgramStreamlined: false });
    expect(p.timing).toEqual({
      current: { ...OBSERVED_TIMING.current, localProgramStreamlined: false },
      saved: null
    });
    expect(() =>
      policyFromLevers({
        ...DEFAULT_LEVERS,
        timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'all' }]
      })
    ).toThrow(PolicyFormatError);
    expect(() =>
      policyFromLevers({
        ...DEFAULT_LEVERS,
        routeShares: { discretionary: 1, streamlined: 1, permitOnly: 1 }
      })
    ).toThrow(PolicyFormatError);
  });

  const rejectTiming = (mut: (t: { current: TimingSet; saved: unknown }) => void) => {
    const p = JSON.parse(JSON.stringify(base({ timing: { current: CUSTOM, saved: null } })));
    mut(p.timing);
    try {
      parseSimPolicy(p);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyFormatError);
      return (e as PolicyFormatError).path;
    }
  };

  it('parseSimPolicy round-trips a custom set with a save', () => {
    const p = base({ timing: { current: CUSTOM, saved: { label: 'Mine', set: CUSTOM } } });
    expect(parseSimPolicy(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects new-reach edits, unknown presets and shares off 100', () => {
    expect(rejectTiming((t) => (t.current.edits[0].reach = 'new'))).toBe(
      'timing.current.edits[0].reach'
    );
    expect(rejectTiming((t) => ((t.current as { preset: string }).preset = 'nope'))).toBe(
      'timing.current.preset'
    );
    expect(rejectTiming((t) => ((t.current as { preset: string }).preset = 'ceqaInfill'))).toBe(
      'timing.current.preset'
    );
    expect(rejectTiming((t) => (t.current.routeShares!.permitOnly = 31))).toBe(
      'timing.current.routeShares'
    );
    expect(rejectTiming((t) => (t.current.presetRouteShares!.permitOnly = 32))).toBe(
      'timing.current.presetRouteShares'
    );
    expect(rejectTiming((t) => (t.current.routeShares!.permitOnly = 29.5))).toBe(
      'timing.current.routeShares.permitOnly'
    );
    expect(rejectTiming((t) => (t.current.presetTimers[0].scale = 0.01))).toBe(
      'timing.current.presetTimers[0].scale'
    );
    expect(rejectTiming((t) => t.current.edits.push({ ...t.current.edits[0], scale: 0.9 }))).toBe(
      'timing.current.edits[1]'
    );
    expect(rejectTiming((t) => (t.current.edits[0].stage = 'entitled'))).toBe(
      'timing.current.edits[0].stage'
    );
    expect(rejectTiming((t) => (t.saved = { label: 3, set: CUSTOM }))).toBe('timing.saved.label');
    expect(
      rejectTiming((t) => (t.saved = { label: 'x', set: { ...CUSTOM, preset: 'nope' } }))
    ).toBe('timing.saved.set.preset');
  });
});

describe('defaultEffect', () => {
  it('sets density limits by mode', () => {
    expect(defaultEffect('raise', 6).densityLimits).toBe(false);
    expect(defaultEffect('set', 6).densityLimits).toBe(true);
    expect(defaultEffect('lower', 2).densityLimits).toBe(true);
  });
});

describe('parseSimPolicy', () => {
  const full = (): SimPolicy =>
    base({
      brushes: [
        freehand('a', [stroke]),
        { id: 'e', kind: 'erase', strokes: [stroke] },
        {
          id: 't',
          kind: 'transit',
          stopTypes: ['metro', 'rapidBus'],
          bands: DEFAULT_BANDS,
          mode: 'raise',
          densityLimits: false
        },
        {
          id: 's',
          kind: 'street',
          classes: [],
          names: ['Geary Blvd'],
          depth: 1,
          ncOnly: true,
          effect: eff('lower', 2)
        },
        {
          id: 'z',
          kind: 'area',
          districts: ['RH-1'],
          neighborhoods: ['Sunset'],
          effect: eff('set', 4)
        }
      ],
      protect: { ...base().protect, strokes: [{ ...stroke, kind: 'protect' }] },
      timing: { current: CUSTOM, saved: { label: 'Mine', set: CUSTOM } }
    });

  it('round-trips one brush of each kind', () => {
    const p = full();
    expect(parseSimPolicy(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  const reject = (
    mut: (p: {
      brushes: {
        effect: { stories: number };
        stopTypes: string[];
        classes: string[];
        depth: number;
      }[];
    }) => void,
    path: string
  ) => {
    const p = JSON.parse(JSON.stringify(full()));
    mut(p);
    try {
      parseSimPolicy(p);
      expect.unreachable('should throw');
    } catch (e) {
      expect((e as { path?: string }).path).toBe(path);
    }
  };

  it('rejects bad stories, stop type, street class and depth', () => {
    reject((p) => (p.brushes[0].effect.stories = 0), 'brushes[0].effect.stories');
    reject((p) => (p.brushes[0].effect.stories = 81), 'brushes[0].effect.stories');
    reject((p) => (p.brushes[2].stopTypes = ['ferry']), 'brushes[2].stopTypes[0]');
    reject((p) => (p.brushes[3].classes = ['highway']), 'brushes[3].classes[0]');
    reject((p) => (p.brushes[3].depth = 2), 'brushes[3].depth');
  });

  it('rejects bad timing, duplicate ids and empty bands', () => {
    const bad = (mut: (p: Record<string, unknown>) => void) => {
      const p = JSON.parse(JSON.stringify(full()));
      mut(p);
      try {
        parseSimPolicy(p);
        expect.unreachable('should throw');
      } catch (e) {
        return (e as { path?: string }).path;
      }
    };
    expect(
      bad((p) => ((p.timing as { current: { edits: unknown } }).current.edits = ['x']))
    ).toMatch(/^timing\.current\.edits/);
    expect(bad((p) => ((p.brushes as { id: string }[])[1].id = 'a'))).toBe('brushes[1].id');
    expect(bad((p) => ((p.brushes as { bands: unknown[] }[])[2].bands = []))).toBe(
      'brushes[2].bands'
    );
  });
});

describe('scoreCopy', () => {
  it('words the comparison', () => {
    const fzp = { plan: 'the Family Zoning Plan', twin: 'the old zoning' };
    expect(scoreCopy(null)).toEqual(fzp);
    expect(scoreCopy(FZP_COMPAT_LEVERS)).toEqual(fzp);
    expect(scoreCopy(DEFAULT_LEVERS)).toEqual({
      plan: 'your policy',
      twin: "the City's current rules"
    });
    expect(scoreCopy({ ...DEFAULT_LEVERS, compare: 'preFzp' })).toEqual({
      plan: 'your policy',
      twin: 'the old zoning'
    });
  });
});
