import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { diff } from './diff';
import { flatten, rulesetText } from './items';
import { listKey, spanKey } from './keys';
import { DEFAULT_SIM_NAME } from './shapes';
import { LogState } from './state';
import type { Change, RulesetContent } from './types';
import { arbEdited, arbPair, arbRuleset } from './test/arbitraries';
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
  type J
} from './test/fixtures';

/** Applies the changes to the state of `a`, then checks it equals `b` in text and in every list. */
const expectApplies = (a: RulesetContent, b: RulesetContent, changes: Change[]): void => {
  const s = LogState.of(a, null);
  s.apply(input(changes));
  expect(rulesetText(s.ruleset())).toBe(rulesetText(b));
  const want = flatten(b).lists;
  const keys = new Set([...flatten(a).lists.keys(), ...want.keys()]);
  for (const k of keys) expect([...s.list(k)]).toStrictEqual(want.get(k) ?? []);
};
const r = (z: unknown[], name?: string) => ruleset(doc(z as never[]), name);

const s1 = { path: [[-122.4, 37.7]], radiusM: 50 };
const s2 = { path: [[-122.41, 37.71]], radiusM: 10 };
const s3 = { path: [[-122.45, 37.76]], radiusM: 50 };
type B = { id: string; kind: string; strokes: unknown[]; stories?: number };
const brushes = (...bs: B[]): J => ({ tag: 'brushes', brushes: bs });
const paint = (id: string, strokes: unknown[], stories = 5): B => ({
  id,
  kind: 'paint',
  strokes,
  stories
});
const onePainted = (...bs: B[]) => r([painted('z2', [open(brushes(...bs))])]);
const strokeKeysOf = (x: RulesetContent) =>
  flatten(x).lists.get(listKey(spanKey('z2', first(1)))) ?? [];

describe('diff', () => {
  it('is empty between equal rulesets', () => {
    fc.assert(
      fc.property(arbRuleset, (x) => {
        expect(diff(x, x)).toStrictEqual([]);
      })
    );
  });

  it('renames with one set', () => {
    expect(diff(r([]), r([], 'Mission'))).toStrictEqual([
      { op: 'set', key: 'sim', field: 'name', value: 'Mission' }
    ]);
  });

  it('switches a policy off with one set', () => {
    expect(diff(r([transit('z1')]), r([{ ...transit('z1'), on: false }]))).toStrictEqual([
      { op: 'set', key: 'p:z1', field: 'on', value: false }
    ]);
  });

  it('reorders policies with one move', () => {
    const a = r([transit('z1'), transit('z3'), painted('z2')]);
    const b = r([painted('z2'), transit('z1'), transit('z3')]);
    const c = diff(a, b);
    expect(c).toStrictEqual([{ op: 'move', key: 'p:z2', after: null }]);
    expectApplies(a, b, c);
  });

  it('truncates with end, and extends by delete and add', () => {
    const open1 = r([transit('z1')]);
    const to6 = r([transit('z1', [span(first(1), last(6), bandsW())])]);
    const k = spanKey('z1', first(1));
    expect(diff(open1, to6)).toStrictEqual([{ op: 'end', key: k, to: last(6) }]);
    const back = diff(to6, open1);
    expect(back.map((c) => [c.op, c.key])).toStrictEqual([
      ['delete', k],
      ['add', k]
    ]);
    expect(back[1]).not.toHaveProperty('after');
    expectApplies(to6, open1, back);
  });

  it('changes stories by replacing the span (R4)', () => {
    const k = spanKey('z1', first(1));
    const a = r([transit('z1')]);
    const b = r([transit('z1', [open(bandsW(8))])]);
    const c = diff(a, b);
    expect(c.map((x) => [x.op, x.key])).toStrictEqual([
      ['delete', k],
      ['add', k]
    ]);
    expectApplies(a, b, c);
  });

  it('adds one stroke after the last', () => {
    const a = onePainted(paint('b1', [s1]));
    const b = onePainted(paint('b1', [s1, s2]));
    const strokes = strokeKeysOf(b);
    const c = diff(a, b);
    expect(c).toStrictEqual([
      {
        op: 'add',
        key: strokes[1],
        shape: 'stroke',
        fields: expect.objectContaining({ brush: 'b1', radiusM: 10 }),
        after: strokes[0]
      }
    ]);
    expectApplies(a, b, c);
  });

  it('changing a policy where replaces it and everything under it', () => {
    const a = r([transit('z1')]);
    const b = r([{ ...transit('z1'), where: { tag: 'transit', stopTypes: ['rapidBus'] } }]);
    const c = diff(a, b);
    expect(c.map((x) => x.op)).toStrictEqual(['delete', 'add', 'add']);
    expectApplies(a, b, c);
  });

  it('refuses a target not in log form', () => {
    const empty = onePainted({ id: 'b1', kind: 'erase', strokes: [] });
    expect(() => diff(r([]), empty)).toThrow(RangeError);
  });

  it('removes the repeat, not the first, of two identical strokes', () => {
    const a = onePainted(paint('b1', [s1, s1]));
    const b = onePainted(paint('b1', [s1]));
    const [k1, k2] = strokeKeysOf(a);
    const c = diff(a, b);
    expect(c).toStrictEqual([{ op: 'delete', key: k2 }]);
    expect(k1).not.toBe(k2);
    expectApplies(a, b, c);
  });

  it('adds a repeat of an identical stroke', () => {
    const a = onePainted(paint('b1', [s1]));
    const b = onePainted(paint('b1', [s1, s1, s2]));
    expectApplies(a, b, diff(a, b));
  });

  it('reorders strokes within a brush', () => {
    const a = onePainted(paint('b1', [s1, s2, s3]));
    const b = onePainted(paint('b1', [s3, s1, s2]));
    const c = diff(a, b);
    expect(c).toHaveLength(1);
    expect(c[0].op).toBe('move');
    expectApplies(a, b, c);
  });

  it('reorders brushes with their strokes', () => {
    const a = onePainted(paint('b1', [s1, s2]), paint('b2', [s3]));
    const b = onePainted(paint('b2', [s3]), paint('b1', [s1, s2]));
    expectApplies(a, b, diff(a, b));
  });

  it('replaces every stroke of a brush that changes kind or stories', () => {
    const a = onePainted(paint('b1', [s1, s2]), paint('b2', [s3]));
    for (const changed of [
      paint('b1', [s1, s2], 8),
      { id: 'b1', kind: 'erase', strokes: [s1, s2] }
    ]) {
      const b = onePainted(changed, paint('b2', [s3]));
      const c = diff(a, b);
      const ops = c.map((x) => x.op);
      expect(ops.filter((o) => o === 'delete')).toHaveLength(2);
      expect(ops.filter((o) => o === 'add')).toHaveLength(2);
      expectApplies(a, b, c);
    }
  });

  it('extends a painted span by deleting it and adding it again with its strokes', () => {
    const k = spanKey('z2', first(1));
    const a = r([painted('z2', [span(first(1), last(6), brushes(paint('b1', [s1, s2])))])]);
    const b = onePainted(paint('b1', [s1, s2]));
    const c = diff(a, b);
    expect(c.map((x) => x.op)).toStrictEqual(['delete', 'add', 'add', 'add']);
    expect(c[0].key).toBe(k);
    expectApplies(a, b, c);
  });

  it('truncates a painted span keeping its strokes', () => {
    const a = onePainted(paint('b1', [s1, s2]));
    const b = r([painted('z2', [span(first(1), last(6), brushes(paint('b1', [s1, s2])))])]);
    const c = diff(a, b);
    expect(c.map((x) => x.op)).toStrictEqual(['end']);
    expectApplies(a, b, c);
  });

  it('applying diff(a, b) to a gives b exactly, order included (R8)', () => {
    fc.assert(
      fc.property(arbPair, ([a, b]) => {
        expectApplies(a, b, diff(a, b));
      }),
      { numRuns: 300 }
    );
  });

  it('applying diff(a, b) gives b exactly when b is an edit of a, both ways (R8)', () => {
    fc.assert(
      fc.property(
        arbRuleset.chain((a) => arbEdited(a).map((b) => [a, b] as const)),
        ([a, b]) => {
          expectApplies(a, b, diff(a, b));
          expectApplies(b, a, diff(b, a));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('a restore reproduces the earlier ruleset exactly (R10)', () => {
    fc.assert(
      fc.property(fc.array(arbRuleset, { minLength: 2, maxLength: 6 }), fc.nat(), (rs, pick) => {
        const s = LogState.empty();
        let prev: RulesetContent = { name: DEFAULT_SIM_NAME, policy: DEFAULT_POLICY4 };
        for (const x of rs) {
          const c = diff(prev, x);
          if (c.length) s.apply(input(c));
          prev = x;
        }
        const target = rs[pick % rs.length];
        const c = diff(s.ruleset(), target);
        if (c.length) s.apply(input(c));
        expect(rulesetText(s.ruleset())).toBe(rulesetText(target));
      })
    );
  });
});
