import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { listKey, spanKey, strokeKeyBase, type StrokeFields } from './keys';
import { flatten, rulesetText, type Item } from './items';
import { DEFAULT_SIM_NAME } from './shapes';
import { LogState, fold } from './state';
import { arbRuleset } from './test/arbitraries';
import {
  bandsW,
  doc,
  first,
  input,
  last,
  open,
  painted,
  ruleset,
  span,
  transit,
  twoVersionRegistry
} from './test/fixtures';
import { LogError, type Change } from './types';

const sk = spanKey;
const metro = {
  id: 'z1',
  kind: 'zoning',
  where: { tag: 'transit', stopTypes: ['metro'] },
  label: 'Metro',
  preset: null,
  on: true
};
const addMetro = {
  op: 'add',
  key: 'p:z1',
  shape: 'policy.transit',
  fields: metro,
  after: null
} as const;
const addSpan = {
  op: 'add',
  key: sk('z1', first(1)),
  shape: 'span.transit',
  fields: { policy: 'z1', from: first(1), to: null, what: bandsW() }
} as const;

describe('fold', () => {
  it('folds nothing to the default ruleset', () => {
    expect(fold([])).toEqual({
      name: DEFAULT_SIM_NAME,
      policy: DEFAULT_POLICY4,
      datasetVersion: null
    });
  });

  it('adds, sets, ends, moves and deletes', () => {
    const r = fold([
      input([addMetro, addSpan]),
      input(
        [
          { op: 'set', key: 'p:z1', field: 'on', value: false },
          { op: 'set', key: 'sim', field: 'name', value: 'Mission' },
          { op: 'end', key: addSpan.key, to: last(12) }
        ],
        { datasetVersion: '2026-11-08-3b7fa918' }
      )
    ]);
    expect(r.name).toBe('Mission');
    expect(r.datasetVersion).toBe('2026-11-08-3b7fa918');
    expect(r.policy.kinds.zoning).toEqual([
      { ...transit('z1', [span(first(1), last(12), bandsW())]), label: 'Metro', on: false }
    ]);
  });

  it('a newer shape revision is future-shapes', () => {
    expect(() => fold([input([addMetro], { shapes: 2 })])).toThrow(
      expect.objectContaining({ code: 'future-shapes' })
    );
  });

  it('an older shape version folds to the same text as its upgraded form', () => {
    const reg = twoVersionRegistry();
    const { label, ...rest } = metro;
    const old = fold(
      [
        input([{ ...addMetro, fields: { ...rest, title: label } }], { shapes: 1 }),
        input([{ op: 'set', key: 'p:z1', field: 'title', value: 'Metro 2' }], { shapes: 1 })
      ],
      reg
    );
    const now = fold(
      [
        input([addMetro], { shapes: 2 }),
        input([{ op: 'set', key: 'p:z1', field: 'label', value: 'Metro 2' }], { shapes: 2 })
      ],
      reg
    );
    expect(rulesetText(old)).toBe(rulesetText(now));
    expect(old.policy.kinds.zoning[0].label).toBe('Metro 2');
  });
});

describe('LogState', () => {
  it('a delete cascades to spans and strokes', () => {
    const s = LogState.of(ruleset(doc([painted('z2')])), null);
    s.apply(input([{ op: 'delete', key: 'p:z2' }]));
    expect(s.ruleset().policy).toEqual(DEFAULT_POLICY4);
    expect(s.list(listKey(sk('z2', first(1))))).toEqual([]);
    expect(s.list('l:zoning')).toEqual([]);
  });

  it('moves within a kind', () => {
    const s = LogState.of(ruleset(doc([transit('z1'), painted('z2')])), null);
    s.apply(input([{ op: 'move', key: 'p:z2', after: null }]));
    expect(s.ruleset().policy.kinds.zoning.map((p) => p.id)).toEqual(['z2', 'z1']);
  });

  it('adds after a named sibling', () => {
    const s = LogState.of(ruleset(doc([transit('z1'), painted('z2')])), null);
    const z3 = { ...metro, id: 'z3' };
    s.apply(input([{ ...addMetro, key: 'p:z3', fields: z3, after: 'p:z1' }]));
    expect(s.list('l:zoning')).toEqual(['p:z1', 'p:z3', 'p:z2']);
  });

  it.each([
    ['an existing key', [addMetro, addMetro], 1],
    ['a missing parent', [addSpan], 0],
    ['a key that does not fit', [{ ...addMetro, key: 'p:z9' }], 0],
    [
      'a listed add without after',
      [{ op: 'add', key: 'p:z1', shape: 'policy.transit', fields: metro }],
      0
    ],
    ['an add of the name', [{ ...addMetro, key: 'sim', shape: 'sim', fields: { name: 'x' } }], 0],
    [
      'an add after a key not in the list',
      [addMetro, { ...addMetro, key: 'p:z2', fields: { ...metro, id: 'z2' }, after: 'p:q' }],
      1
    ],
    ['an unknown shape', [{ ...addMetro, shape: 'policy.street' }], 0],
    [
      'a set of a fixed field',
      [addMetro, { op: 'set', key: 'p:z1', field: 'preset', value: 'x' }],
      1
    ],
    ['an untrimmed name', [{ op: 'set', key: 'sim', field: 'name', value: ' x' }], 0],
    [
      'an end that extends',
      [
        addMetro,
        addSpan,
        { op: 'end', key: addSpan.key, to: last(3) },
        { op: 'end', key: addSpan.key, to: last(6) }
      ],
      3
    ],
    [
      'an end before from',
      [addMetro, addSpan, { op: 'end', key: addSpan.key, to: first(1) - 1 }],
      2
    ],
    ['a move of a span', [addMetro, addSpan, { op: 'move', key: addSpan.key, after: null }], 2],
    ['a move after itself', [addMetro, { op: 'move', key: 'p:z1', after: 'p:z1' }], 1],
    ['a delete of the name', [{ op: 'delete', key: 'sim' }], 0],
    ['a delete of nothing', [{ op: 'delete', key: 'p:z1' }], 0]
  ])('refuses %s, naming the change', (_, changes, index) => {
    expect(() => fold([input(changes as Change[])])).toThrow(
      expect.objectContaining({ code: 'invalid-change', index })
    );
  });

  it('apply is atomic', () => {
    const s = LogState.of(ruleset(doc([transit('z1')])), null);
    const before = rulesetText(s.ruleset());
    expect(() =>
      s.apply(
        input([
          { op: 'set', key: 'p:z1', field: 'on', value: false },
          { op: 'delete', key: 'p:z9' }
        ])
      )
    ).toThrow(LogError);
    expect(rulesetText(s.ruleset())).toBe(before);
    expect(s.item('p:z1')?.fields.on).toBe(true);
  });

  it('apply with check rolls back a ruleset that does not parse', () => {
    const s = LogState.of(ruleset(doc([transit('z1', [span(first(1), last(6), bandsW())])])), null);
    const before = rulesetText(s.ruleset());
    const overlap = {
      op: 'add',
      key: sk('z1', first(3)),
      shape: 'span.transit',
      fields: { policy: 'z1', from: first(3), to: null, what: bandsW() }
    } as const;
    expect(() => s.apply(input([overlap]), { check: true })).toThrow(
      expect.objectContaining({ code: 'invalid-ruleset' })
    );
    expect(rulesetText(s.ruleset())).toBe(before);
    expect(s.item(overlap.key)).toBeUndefined();
  });

  it('of() holds the ruleset it was given', () => {
    fc.assert(
      fc.property(arbRuleset, (r) => {
        expect(rulesetText(LogState.of(r, null).ruleset())).toBe(rulesetText(r));
      })
    );
  });

  it('clone is independent', () => {
    const s = LogState.of(ruleset(doc([transit('z1')])), null);
    const c = s.clone();
    c.apply(input([{ op: 'delete', key: 'p:z1' }]));
    expect(s.ruleset().policy.kinds.zoning).toHaveLength(1);
    expect(c.ruleset().policy.kinds.zoning).toHaveLength(0);
  });

  it('memoises the ruleset until the next apply', () => {
    const s = LogState.of(ruleset(doc([transit('z1')])), null);
    const a = s.ruleset();
    expect(s.ruleset()).toBe(a);
    s.apply(input([{ op: 'set', key: 'p:z1', field: 'on', value: false }]));
    expect(s.ruleset()).not.toBe(a);
  });
});

describe('strokes', () => {
  const sp = sk('z2', first(1));
  const base: StrokeFields = {
    span: sp,
    brush: 'b1',
    kind: 'paint',
    stories: 5,
    path: [[-122.4, 37.7]],
    radiusM: 50
  };
  const D = strokeKeyBase(base);
  const addStroke = (key: string, f: Partial<StrokeFields>, after: string | null): Change => ({
    op: 'add',
    key,
    shape: 'stroke',
    fields: { ...base, ...f },
    after
  });
  const twice = () => {
    const stroke = { path: [[-122.4, 37.7]], radiusM: 50 };
    const brushes = [{ id: 'b1', kind: 'paint', strokes: [stroke, stroke], stories: 5 }];
    return LogState.of(ruleset(doc([painted('z2', [open({ tag: 'brushes', brushes })])])), null);
  };

  it('refuses a stroke that disagrees with its brush, atomically', () => {
    const s = LogState.of(ruleset(doc([painted('z2')])), null);
    const before = rulesetText(s.ruleset());
    for (const f of [{ stories: 9 }, { kind: 'erase' as const, stories: null }]) {
      const k = strokeKeyBase({ ...base, ...f });
      expect(() => s.apply(input([addStroke(k, f, null)]))).toThrow(
        expect.objectContaining({ code: 'invalid-change', index: 0 })
      );
      expect(s.item(k)).toBeUndefined();
    }
    expect(rulesetText(s.ruleset())).toBe(before);
  });

  it('accepts a stroke that agrees with its brush, and one of a new brush', () => {
    const s = LogState.of(ruleset(doc([painted('z2')])), null);
    const f = { path: [[-122.41, 37.71]] as [number, number][] };
    const k = strokeKeyBase({ ...base, ...f });
    s.apply(input([addStroke(k, f, null)]));
    const g = { brush: 'b2', stories: 9 };
    s.apply(input([addStroke(strokeKeyBase({ ...base, ...g }), g, k)]));
    const what = s.ruleset().policy.kinds.zoning[0].spans[0].what;
    expect(what.tag === 'brushes' && what.brushes.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('holds repeated strokes under k:D, k:D~2', () => {
    expect(twice().list(listKey(sp))).toEqual([D, `${D}~2`]);
  });

  it('refuses a commit that leaves a gap in the repeat keys, atomically', () => {
    const s = twice();
    const before = rulesetText(s.ruleset());
    expect(() => s.apply(input([{ op: 'delete', key: D }]))).toThrow(
      expect.objectContaining({ code: 'invalid-change' })
    );
    expect(s.list(listKey(sp))).toEqual([D, `${D}~2`]);
    expect(rulesetText(s.ruleset())).toBe(before);
  });

  it('accepts deleting the highest repeat', () => {
    const s = twice();
    s.apply(input([{ op: 'delete', key: `${D}~2` }]));
    expect(s.list(listKey(sp))).toEqual([D]);
  });

  it('refuses an add that skips a repeat number', () => {
    const s = twice();
    expect(() => s.apply(input([addStroke(`${D}~4`, {}, D)]))).toThrow(
      expect.objectContaining({ code: 'invalid-change' })
    );
    s.apply(input([addStroke(`${D}~3`, {}, D)]));
    expect(s.list(listKey(sp))).toEqual([D, `${D}~3`, `${D}~2`]);
  });

  it('accepts deleting the whole span with its repeats', () => {
    const s = twice();
    s.apply(input([{ op: 'delete', key: sp }]));
    expect(s.list(listKey(sp))).toEqual([]);
  });
});

describe('item keys and lists', () => {
  const keysOf = (s: LogState) =>
    [...(s as unknown as { items: Map<string, Item> }).items.keys()].sort();

  it('state keys equal the keys of flatten(ruleset) after any accepted commits', () => {
    fc.assert(
      fc.property(arbRuleset, fc.array(fc.nat(), { maxLength: 6 }), (r, picks) => {
        const s = LogState.of(r, null);
        expect(keysOf(s)).toEqual([...flatten(r).items.keys()].sort());
        for (const n of picks) {
          const keys = keysOf(s).filter((k) => k !== 'sim');
          if (keys.length === 0) break;
          try {
            s.apply(input([{ op: 'delete', key: keys[n % keys.length] }]));
          } catch (e) {
            expect(e).toBeInstanceOf(LogError);
          }
          const flat = flatten(s.ruleset());
          expect(keysOf(s)).toEqual([...flat.items.keys()].sort());
          for (const k of keysOf(s)) {
            if (k.startsWith('s:') || k.startsWith('p:')) {
              expect(s.list(listKey(k))).toEqual(flat.lists.get(listKey(k)) ?? []);
            }
          }
          for (const [k, list] of flat.lists) expect(s.list(k)).toEqual(list);
        }
      })
    );
  });
});
