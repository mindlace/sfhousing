import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVERS, parseSimLevers, type TimerEdit } from '$lib/sim/levers/types';
import { CALCULATING } from '$lib/fzp/copy';
import { PolicyStore } from './policy-store.svelte';
import { OBSERVED_TIMING, type TimingSet } from './timing';
import {
  DEFAULT_BANDS,
  DEFAULT_POLICY,
  PolicyFormatError,
  type PresetLayerMode,
  compileLevers,
  customQuery,
  isDefaultPolicy,
  paintBrushOf,
  paintedLots,
  parseSimPolicy,
  queriesOf,
  queryKey,
  comparisonLine,
  ruleQueries,
  scoreCopy,
  type CustomBrush,
  type Lots,
  type SimPolicy,
  type Stroke,
  type TransitBand,
  type ZoningRule
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
const s = (r: number): Stroke => ({ path: [[-122, 37]], radiusM: r });
const lotsOf =
  (m: Record<string, string[]>): Lots =>
  (k) =>
    m[k];
const T = (bands: TransitBand[]): ZoningRule => ({
  id: 't',
  kind: 'transit',
  stopTypes: ['metro'],
  bands
});
const transit = (id: string, stories = 6): ZoningRule => ({
  ...T([{ maxM: 402, stories }]),
  id
});
const STREET_RAW = {
  id: 's',
  kind: 'street',
  classes: ['arterial'],
  names: [],
  depth: 0,
  ncOnly: true,
  stories: 6
};
const rawPolicy = (rules: unknown[]) => ({ ...structuredClone(DEFAULT_POLICY), rules });
const paint = (id: string, strokes: Stroke[], stories = 6): CustomBrush => ({
  id,
  kind: 'paint',
  strokes,
  stories
});

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
  it('the default policy compiles to DEFAULT_LEVERS', () => {
    expect(isDefaultPolicy(DEFAULT_POLICY)).toBe(true);
    expect(compileLevers(DEFAULT_POLICY, () => [])).toEqual(DEFAULT_LEVERS);
  });

  it('transit bands compile to rules; the inner band wins where both apply', () => {
    const p = {
      ...DEFAULT_POLICY,
      rules: [
        T([
          { maxM: 402, stories: 8 },
          { maxM: 805, stories: 5 }
        ])
      ]
    };
    const [outer, inner] = ruleQueries(p.rules[0]).map(queryKey);
    const l = compileLevers(p, lotsOf({ [outer]: ['a', 'b'], [inner]: ['a'] }))!;
    expect(l.rules).toEqual([
      { lots: ['a', 'b'], stories: 5, source: 't' },
      { lots: ['a'], stories: 8, source: 't' }
    ]);
    expect(l.compare).toBe('fzp');
  });

  it('rules compile in list order, each lot list sorted; an empty rule emits no edit', () => {
    const a = transit('b', 9);
    const b: ZoningRule = { ...transit('a', 4), stopTypes: ['rapidBus'] };
    const p = base({ rules: [a, b] });
    const k = (r: ZoningRule) => queryKey(ruleQueries(r)[0]);
    const l = compileLevers(p, lotsOf({ [k(a)]: ['2', '1'], [k(b)]: [] }))!;
    expect(l.rules).toEqual([{ lots: ['1', '2'], stories: 9, source: 'b' }]);
    expect(() => parseSimLevers(l)).not.toThrow();
  });

  it('compileLevers stamps each rule band edit with its rule id; paint edits have none', () => {
    const st: Stroke = { path: [[-122.4, 37.77]], radiusM: 20 };
    const r = transit('rule-a', 6);
    const paint = { id: '1', kind: 'paint' as const, strokes: [st], stories: 9 };
    const p = base({ rules: [r], custom: [paint] });
    const l = compileLevers(
      p,
      lotsOf({ [queryKey(ruleQueries(r)[0])]: ['a'], [queryKey(customQuery(paint))]: ['b'] })
    )!;
    expect(l.rules.length).toBeGreaterThan(0);
    expect(l.rules.every((e) => e.source === 'rule-a')).toBe(true);
    expect(l.paint.length).toBeGreaterThan(0);
    expect(l.paint.every((e) => !('source' in e))).toBe(true);
  });

  it('erase removes earlier paint only; paint order is kept', () => {
    const st: Stroke = { path: [[-122.4, 37.77]], radiusM: 20 };
    const p: SimPolicy = {
      ...DEFAULT_POLICY,
      custom: [
        { id: '1', kind: 'paint', strokes: [st], stories: 9 },
        { id: '2', kind: 'erase', strokes: [{ ...st, radiusM: 10 }] },
        { id: '3', kind: 'paint', strokes: [{ ...st, radiusM: 5 }], stories: 3 }
      ]
    };
    const [k1, k2, k3] = p.custom.map((b) => queryKey(customQuery(b)));
    const lots = lotsOf({ [k1]: ['a', 'b', 'c'], [k2]: ['a', 'b'], [k3]: ['b'] });
    expect(compileLevers(p, lots)!.paint).toEqual([
      { lots: ['c'], stories: 9 },
      { lots: ['b'], stories: 3 }
    ]);
    expect(paintedLots(p, lots)).toEqual(
      new Map([
        ['c', 9],
        ['b', 3]
      ])
    );
  });

  it('erase never touches rules', () => {
    const r = transit('r', 7);
    const p = base({ rules: [r], custom: [{ id: 'e', kind: 'erase', strokes: [s(1)] }] });
    const lots = lotsOf({
      [queryKey(ruleQueries(r)[0])]: ['1'],
      [queryKey(customQuery(p.custom[0]))]: ['1']
    });
    expect(compileLevers(p, lots)!.rules).toEqual([{ lots: ['1'], stories: 7, source: 'r' }]);
    expect(paintedLots(p, lots)).toEqual(new Map());
  });

  it('returns null while a key is missing', () => {
    expect(compileLevers(base({ custom: [paint('a', [s(1)])] }), () => undefined)).toBeNull();
    expect(compileLevers(base({ rules: [transit('a')] }), () => undefined)).toBeNull();
    expect(paintedLots(base({ custom: [paint('a', [s(1)])] }), () => undefined)).toBeNull();
  });

  it('maps category protections and timing', () => {
    const p = base({ protect: { ...DEFAULT_POLICY.protect, historic: true, newerThanYears: 5 } });
    expect(compileLevers(p, () => [])).toEqual({
      ...DEFAULT_LEVERS,
      protect: { ...DEFAULT_LEVERS.protect, historic: true, newerThanYears: 5 },
      compare: 'fzp'
    });
  });

  it('undoing back to the default compares with pre-FZP again', () => {
    const store = new PolicyStore(DEFAULT_POLICY);
    store.apply((p) => ({ ...p, protect: { ...p.protect, historic: true } }), 'x');
    expect(compileLevers(store.policy, () => [])!.compare).toBe('fzp');
    store.undo();
    expect(compileLevers(store.policy, () => [])!.compare).toBe('preFzp');
  });

  it('a timing change alone is a customisation', () => {
    const p = {
      ...DEFAULT_POLICY,
      timing: {
        ...DEFAULT_POLICY.timing,
        current: { ...DEFAULT_POLICY.timing.current, localProgramStreamlined: false }
      }
    };
    expect(isDefaultPolicy(p)).toBe(false);
  });

  it('a saved timing snapshot alone is not a customisation', () => {
    const saved = { label: 'x', set: OBSERVED_TIMING.current };
    expect(isDefaultPolicy(base({ timing: { ...DEFAULT_POLICY.timing, saved } }))).toBe(true);
  });
});

describe('paintBrushOf', () => {
  const erase = (id: string, strokes: Stroke[]): CustomBrush => ({ id, kind: 'erase', strokes });
  const p = base({
    custom: [paint('a', [s(1)], 8), paint('b', [s(2)], 4), erase('e', [s(3)]), paint('c', [s(4)])]
  });
  const [ka, kb, ke, kc] = p.custom.map((b) => queryKey(customQuery(b)));
  const lots = lotsOf({ [ka]: ['1', '2', '3'], [kb]: ['2', '3'], [ke]: ['3'], [kc]: ['4', '3'] });

  it('returns the last paint brush covering the lot', () => {
    expect(paintBrushOf(p, lots, '1')).toBe('a');
    expect(paintBrushOf(p, lots, '2')).toBe('b');
  });

  it('an erase after the paint returns null; a later paint after the erase wins', () => {
    const noC = base({ custom: p.custom.slice(0, 3) });
    expect(paintBrushOf(noC, lots, '3')).toBeNull();
    expect(paintBrushOf(p, lots, '3')).toBe('c');
  });

  it('a lot no brush covers returns null', () => {
    expect(paintBrushOf(p, lots, '9')).toBeNull();
  });

  it('an unknown query returns null', () => {
    expect(paintBrushOf(p, lotsOf({ [ka]: ['1'] }), '1')).toBeNull();
  });
});

describe('queries', () => {
  it('a transit rule has one query per band, outermost first', () => {
    expect(ruleQueries(T(DEFAULT_BANDS))).toEqual([
      { kind: 'transit', stopTypes: ['metro'], maxM: 805 },
      { kind: 'transit', stopTypes: ['metro'], maxM: 402 }
    ]);
  });

  it('a custom brush is one freehand query; queriesOf dedupes across rules and custom', () => {
    const b = paint('a', [s(1)]);
    expect(customQuery(b)).toEqual({ kind: 'freehand', strokes: [s(1)] });
    const p = base({
      rules: [transit('a'), transit('b')],
      custom: [b, { id: 'e', kind: 'erase', strokes: [s(1)] }]
    });
    expect(queriesOf(p).map((q) => q.query)).toEqual([
      ruleQueries(transit('a'))[0],
      { kind: 'freehand', strokes: [s(1)] }
    ]);
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

describe('parseSimPolicy', () => {
  const full = (): SimPolicy =>
    base({
      rules: [
        { id: 't', kind: 'transit', stopTypes: ['metro', 'rapidBus'], bands: DEFAULT_BANDS },
        {
          id: 's',
          kind: 'transit',
          stopTypes: ['rapidBus'],
          bands: [{ maxM: 300, stories: 5 }]
        }
      ],
      custom: [paint('a', [stroke]), { id: 'e', kind: 'erase', strokes: [stroke] }],
      protect: { rentControl: true, historic: false, newerThanYears: 20 },
      timing: { current: CUSTOM, saved: { label: 'Mine', set: CUSTOM } }
    });

  it('round-trips each kind of rule and custom brush', () => {
    const p = full();
    expect(parseSimPolicy(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathOf = (mut: (p: any) => void) => {
    const p = JSON.parse(JSON.stringify(full()));
    mut(p);
    try {
      parseSimPolicy(p);
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyFormatError);
      return (e as PolicyFormatError).path;
    }
  };
  const tr = (bands: TransitBand[]) => ({ ...DEFAULT_POLICY, rules: [T(bands)] });

  it('rejects transit bands that get taller with distance (equal is allowed)', () => {
    expect(() =>
      parseSimPolicy(
        tr([
          { maxM: 402, stories: 4 },
          { maxM: 805, stories: 6 }
        ])
      )
    ).toThrow(/rules\[0\]\.bands/);
    expect(
      parseSimPolicy(
        tr([
          { maxM: 402, stories: 6 },
          { maxM: 805, stories: 6 }
        ])
      ).rules
    ).toHaveLength(1);
  });

  it('compares bands after sorting by distance, and rejects two bands at one distance', () => {
    const ok = [
      { maxM: 805, stories: 4 },
      { maxM: 402, stories: 6 }
    ];
    expect(parseSimPolicy(tr(ok)).rules[0]).toEqual(T(ok));
    expect(() =>
      parseSimPolicy(
        tr([
          { maxM: 805, stories: 6 },
          { maxM: 402, stories: 4 }
        ])
      )
    ).toThrow(/rules\[0\]\.bands/);
    expect(() =>
      parseSimPolicy(
        tr([
          { maxM: 402, stories: 6 },
          { maxM: 402, stories: 4 }
        ])
      )
    ).toThrow(/rules\[0\]\.bands/);
  });

  it('rejects bad stories and stop type', () => {
    expect(pathOf((p) => (p.custom[0].stories = 0))).toBe('custom[0].stories');
    expect(pathOf((p) => (p.rules[1].bands[0].stories = 81))).toBe('rules[1].bands[0].stories');
    expect(pathOf((p) => (p.rules[0].bands[0].stories = 0))).toBe('rules[0].bands[0].stories');
    expect(pathOf((p) => (p.rules[0].stopTypes = ['ferry']))).toBe('rules[0].stopTypes[0]');
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathOfRaw = (json: any, presetLayer: PresetLayerMode = 'strict') => {
    try {
      parseSimPolicy(json, { presetLayer });
    } catch (e) {
      if (e instanceof PolicyFormatError) return e.path;
      throw e;
    }
    return null;
  };

  it('reconcile drops a stored street rule and keeps the rest', () => {
    const t = transit('t');
    const p = {
      ...rawPolicy([STREET_RAW, t]),
      custom: [paint('p', [s(30)])],
      protect: { rentControl: true, historic: false, newerThanYears: null }
    };
    const got = parseSimPolicy(p, { presetLayer: 'reconcile' });
    expect(got.rules).toEqual([t]);
    expect(got.custom).toEqual(p.custom);
    expect(got.protect).toEqual(p.protect);
  });
  it('strict rejects a street rule at its kind', () => {
    expect(() => parseSimPolicy(rawPolicy([STREET_RAW]))).toThrow(PolicyFormatError);
    expect(pathOfRaw(rawPolicy([STREET_RAW]))).toBe('rules[0].kind');
  });
  it('reconcile still rejects another unknown rule kind', () => {
    const p = rawPolicy([{ ...STREET_RAW, kind: 'corridor' }]);
    expect(pathOfRaw(p, 'reconcile')).toBe('rules[0].kind');
  });
  it('reconcile keeps stored indices in error paths after a dropped rule', () => {
    const p = rawPolicy([STREET_RAW, { ...transit('t'), bands: [] }]);
    expect(pathOfRaw(p, 'reconcile')).toBe('rules[1].bands');
  });
  it("a dropped street rule's id is not a duplicate", () => {
    const p = rawPolicy([{ ...STREET_RAW, id: 'x' }, transit('x')]);
    expect(parseSimPolicy(p, { presetLayer: 'reconcile' }).rules.map((r) => r.id)).toEqual(['x']);
  });

  it('rejects bad timing, duplicate ids across both lists, empty bands and a bad stroke', () => {
    expect(pathOf((p) => (p.timing.current.edits = ['x']))).toMatch(/^timing\.current\.edits/);
    expect(pathOf((p) => (p.rules[1].id = 't'))).toBe('rules[1].id');
    expect(pathOf((p) => (p.custom[0].id = 't'))).toBe('custom[0].id');
    expect(pathOf((p) => (p.rules[0].bands = []))).toBe('rules[0].bands');
    expect(pathOf((p) => (p.custom[0].strokes[0].radiusM = 0))).toBe(
      'custom[0].strokes[0].radiusM'
    );
    expect(pathOf((p) => (p.protect.newerThanYears = 0))).toBe('protect.newerThanYears');
  });
});

describe('comparisonLine', () => {
  it('names what the comparison is against', () => {
    const fzp = scoreCopy(null);
    const mine = scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' });
    expect(comparisonLine(fzp, 1234)).toBe('FZP added 1,234 homes vs no FZP');
    expect(comparisonLine(mine, 56)).toBe('Your policy added 56 homes vs FZP');
    expect(comparisonLine(mine, -56)).toBe('Your policy added \u221256 homes vs FZP');
    expect(comparisonLine(mine, null)).toBe(`Your policy vs FZP: ${CALCULATING}`);
    expect(comparisonLine(fzp, null)).toBe(`FZP vs no FZP: ${CALCULATING}`);
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
