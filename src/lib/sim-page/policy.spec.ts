import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS, parseSimLevers } from '$lib/sim/levers/types';
import {
  DEFAULT_BANDS,
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
      protect: { ...base().protect, strokes: [{ ...stroke, kind: 'protect' }] }
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
