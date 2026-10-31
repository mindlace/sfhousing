import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVERS, parseSimLevers, type TimerEdit } from '$lib/sim/levers/types';
import { OBSERVED_TIMING, type TimingSet } from './timing';
import {
  DEFAULT_BANDS,
  DEFAULT_POLICY,
  PolicyFormatError,
  compileLevers,
  defaultEffect,
  lotRoles,
  isDefaultPolicy,
  parseSimPolicy,
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
  ...DEFAULT_POLICY,
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

/** A custom set on benchmarkPermits: its preset timers, one edit and custom route shares. */
const CUSTOM: TimingSet = {
  preset: 'benchmarkPermits',
  presetTimers: [
    { pathway: 'discretionary', stage: 'permitFiled', scale: 0.4786, reach: 'all' },
    { pathway: 'streamlined', stage: 'permitFiled', scale: 0.4786, reach: 'all' },
    { pathway: 'permitOnly', stage: 'permitFiled', scale: 0.4786, reach: 'all' }
  ],
  presetRouteShares: null,
  edits: [{ pathway: 'discretionary', stage: 'filed', scale: 0.8, reach: 'all' }],
  routeShares: { discretionary: 10, streamlined: 60, permitOnly: 30 },
  localProgramStreamlined: true
};
const NO_DISC: TimingSet = {
  preset: 'noDiscretionary',
  presetTimers: [],
  presetRouteShares: { discretionary: 0, streamlined: 67, permitOnly: 33 },
  edits: [],
  routeShares: null,
  localProgramStreamlined: true
};
const SB423: TimingSet = {
  preset: 'sb423Clock',
  presetTimers: [{ pathway: 'streamlined', stage: 'filed', scale: 0.17, reach: 'new' }],
  presetRouteShares: null,
  edits: [],
  routeShares: null,
  localProgramStreamlined: true
};

describe('compileLevers', () => {
  it('compiles the default policy to the default levers', () => {
    expect(isDefaultPolicy(DEFAULT_POLICY)).toBe(true);
    expect(compileLevers(DEFAULT_POLICY, () => undefined)).toEqual(DEFAULT_LEVERS);
  });

  it('ignores stock, assumeAlternativePlanKept and the document compare', () => {
    const p = base({ stock: ['currentLaw', 'sb79'], assumeAlternativePlanKept: true });
    const out = compileLevers(p, () => undefined)!;
    expect(out).toEqual({ ...DEFAULT_LEVERS, compare: 'fzp' });
    expect(compileLevers(base({ compare: 'currentLaw' }), () => undefined)!.compare).toBe('fzp');
  });

  it('raises become rules; lower and set become paint in order, density limits dropped', () => {
    const p = base({
      brushes: [freehand('a', [s(1)], 'set'), freehand('b', [s(2)]), freehand('c', [s(3)], 'lower')]
    });
    const m = new Map<string, string[]>([
      [queryKey({ kind: 'freehand', strokes: [s(1)] }), ['1']],
      [queryKey({ kind: 'freehand', strokes: [s(2)] }), ['2']],
      [queryKey({ kind: 'freehand', strokes: [s(3)] }), ['3']]
    ]);
    const out = compileLevers(p, supply(m))!;
    expect(out.rules).toEqual([{ lots: ['2'], stories: 6 }]);
    expect(out.paint).toEqual([
      { lots: ['1'], stories: 6 },
      { lots: ['3'], stories: 6 }
    ]);
    expect(out.compare).toBe('fzp');
    expect(() => parseSimLevers(out)).not.toThrow();
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
    expect(out?.rules).toEqual([]);
    expect(out?.paint).toEqual([]);
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
    expect(out.rules.map((u) => u.lots)).toEqual([['1', '3']]);
    expect(out.paint.map((u) => u.lots)).toEqual([['2', '4']]);
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
    expect(out.rules.map((u) => [u.stories, u.lots])).toEqual([
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
    const p = base({ protect: { ...DEFAULT_POLICY.protect, historic: true, newerThanYears: 5 } });
    expect(compileLevers(p, () => undefined)).toEqual({
      ...DEFAULT_LEVERS,
      protect: { ...DEFAULT_LEVERS.protect, historic: true, newerThanYears: 5 },
      compare: 'fzp'
    });
  });
});

describe('timing in the policy', () => {
  const compile = (t: TimingSet) =>
    compileLevers(base({ timing: { current: t, saved: null } }), () => undefined)!;

  it('compiles preset timers then edits, and custom shares over the preset', () => {
    const l = compile(CUSTOM);
    expect(l.timers).toEqual([...CUSTOM.presetTimers, ...CUSTOM.edits]);
    expect(l.routeShares).toEqual(CUSTOM.routeShares);
    expect(compile(NO_DISC).routeShares).toEqual(NO_DISC.presetRouteShares);
  });

  it('a custom edit replaces the preset timer on its stage', () => {
    const edit = {
      pathway: 'streamlined',
      stage: 'permitFiled',
      scale: 0.9,
      reach: 'all'
    } as const;
    const l = compile({ ...CUSTOM, edits: [...CUSTOM.edits, edit] });
    expect(l.timers).toEqual([
      CUSTOM.presetTimers[0],
      CUSTOM.presetTimers[2],
      ...CUSTOM.edits,
      edit
    ]);
  });

  it('the default policy runs on the observed timing set', () => {
    expect(DEFAULT_POLICY.timing).toEqual({ current: OBSERVED_TIMING.current, saved: null });
  });

  const rejectTiming = (
    mut: (t: { current: TimingSet; saved: unknown }) => void,
    start: TimingSet = CUSTOM
  ) => {
    const p = JSON.parse(JSON.stringify(base({ timing: { current: start, saved: null } })));
    mut(p.timing);
    try {
      parseSimPolicy(p);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyFormatError);
      return (e as PolicyFormatError).path;
    }
  };

  it('parseSimPolicy round-trips a custom set with a save, and every preset shape', () => {
    const p = base({ timing: { current: CUSTOM, saved: { label: 'Mine', set: CUSTOM } } });
    expect(parseSimPolicy(JSON.parse(JSON.stringify(p)))).toEqual(p);
    for (const t of [NO_DISC, SB423, OBSERVED_TIMING.current]) {
      const q = base({ timing: { current: t, saved: null } });
      expect(parseSimPolicy(JSON.parse(JSON.stringify(q)))).toEqual(q);
    }
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
    expect(rejectTiming((t) => (t.current.presetRouteShares!.permitOnly = 32), NO_DISC)).toBe(
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

  describe('rejects a preset layer that contradicts its preset', () => {
    const timer = (over: Partial<TimerEdit>): TimerEdit => ({
      pathway: 'discretionary',
      stage: 'permitFiled',
      scale: 0.5,
      reach: 'all',
      ...over
    });
    it('observed: no timers, no shares', () => {
      const obs = OBSERVED_TIMING.current;
      expect(rejectTiming((t) => t.current.presetTimers.push(timer({})), obs)).toBe(
        'timing.current.presetTimers[0]'
      );
      expect(
        rejectTiming(
          (t) =>
            (t.current.presetRouteShares = { discretionary: 50, streamlined: 25, permitOnly: 25 }),
          obs
        )
      ).toBe('timing.current.presetRouteShares');
    });
    it('noDiscretionary: no timers, shares with discretionary 0', () => {
      expect(rejectTiming((t) => t.current.presetTimers.push(timer({})), NO_DISC)).toBe(
        'timing.current.presetTimers[0]'
      );
      expect(rejectTiming((t) => (t.current.presetRouteShares = null), NO_DISC)).toBe(
        'timing.current.presetRouteShares'
      );
      expect(
        rejectTiming(
          (t) =>
            (t.current.presetRouteShares = { discretionary: 1, streamlined: 66, permitOnly: 33 }),
          NO_DISC
        )
      ).toBe('timing.current.presetRouteShares.discretionary');
    });
    it('sb423Clock: only streamlined filed, reach new, scale at most 1, no shares', () => {
      const at = 'timing.current.presetTimers[0]';
      expect(
        rejectTiming((t) => (t.current.presetTimers[0].pathway = 'discretionary'), SB423)
      ).toBe(at);
      expect(rejectTiming((t) => (t.current.presetTimers[0].reach = 'all'), SB423)).toBe(at);
      expect(rejectTiming((t) => (t.current.presetTimers[0].scale = 1.5), SB423)).toBe(at);
      expect(
        rejectTiming(
          (t) =>
            (t.current.presetRouteShares = { discretionary: 0, streamlined: 67, permitOnly: 33 }),
          SB423
        )
      ).toBe('timing.current.presetRouteShares');
    });
    it('benchmarkPermits: only permitFiled, reach all, at the ratio or up to 1, no shares', () => {
      expect(rejectTiming((t) => (t.current.presetTimers[0].stage = 'filed'))).toBe(
        'timing.current.presetTimers[0]'
      );
      expect(rejectTiming((t) => (t.current.presetTimers[1].reach = 'new'))).toBe(
        'timing.current.presetTimers[1]'
      );
      expect(rejectTiming((t) => (t.current.presetTimers[2].scale = 0.2))).toBe(
        'timing.current.presetTimers[2]'
      );
      expect(rejectTiming((t) => (t.current.presetTimers[2].scale = 1.2))).toBe(
        'timing.current.presetTimers[2]'
      );
      expect(
        rejectTiming(
          (t) =>
            (t.current.presetRouteShares = { discretionary: 0, streamlined: 67, permitOnly: 33 })
        )
      ).toBe('timing.current.presetRouteShares');
    });
    it('every preset: no duplicate or locked-stage timers, Local Program kept', () => {
      expect(
        rejectTiming((t) => t.current.presetTimers.push({ ...t.current.presetTimers[0] }))
      ).toBe('timing.current.presetTimers[3]');
      expect(rejectTiming((t) => (t.current.presetTimers[0].stage = 'entitled'))).toBe(
        'timing.current.presetTimers[0].stage'
      );
      expect(rejectTiming((t) => (t.current.localProgramStreamlined = false))).toBe(
        'timing.current.localProgramStreamlined'
      );
    });
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
    const fzp = { plan: 'the Family Zoning Plan', twin: 'the old zoning', compare: 'preFzp' };
    expect(scoreCopy(null)).toEqual(fzp);
    expect(scoreCopy(DEFAULT_LEVERS)).toEqual(fzp);
    expect(scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' })).toEqual({
      plan: 'your policy',
      twin: 'the Family Zoning Plan as written',
      compare: 'fzp'
    });
  });
});

describe('parseSimPolicy preset layer modes', () => {
  const raw = (mut: (t: { current: TimingSet }) => void) => {
    const p = JSON.parse(JSON.stringify(base({ timing: { current: CUSTOM, saved: null } })));
    mut(p.timing);
    return p;
  };
  const pathOf = (p: unknown) => {
    try {
      parseSimPolicy(p);
      return null;
    } catch (e) {
      return (e as PolicyFormatError).path;
    }
  };
  const lenient = { presetLayer: 'reconcile' } as const;

  it('reconcile accepts a retired preset and an out-of-range benchmark scale', () => {
    const retired = raw((t) => ((t.current as { preset: string }).preset = 'ceqaInfill'));
    const scaled = raw((t) => (t.current.presetTimers[0].scale = 0.3));
    expect(() => parseSimPolicy(retired, lenient)).not.toThrow();
    expect(() => parseSimPolicy(scaled, lenient)).not.toThrow();
    expect(pathOf(retired)).toBe('timing.current.preset');
    expect(pathOf(scaled)).toBe('timing.current.presetTimers[0]');
  });

  it('reconcile still rejects duplicate preset timers and a non-editable stage', () => {
    const dup = raw((t) => t.current.presetTimers.push({ ...t.current.presetTimers[0] }));
    const locked = raw((t) => (t.current.presetTimers[0].stage = 'entitled'));
    expect(() => parseSimPolicy(dup, lenient)).toThrow(PolicyFormatError);
    expect(() => parseSimPolicy(locked, lenient)).toThrow(PolicyFormatError);
  });

  it('both modes reject a new-reach edit and duplicate edits', () => {
    const reach = raw((t) => (t.current.edits[0].reach = 'new'));
    const dup = raw((t) => t.current.edits.push({ ...t.current.edits[0] }));
    for (const p of [reach, dup]) {
      expect(() => parseSimPolicy(p)).toThrow(PolicyFormatError);
      expect(() => parseSimPolicy(p, lenient)).toThrow(PolicyFormatError);
    }
  });
});
