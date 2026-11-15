import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkRuleset } from './check';
import { diff } from './diff';
import { flatten, rulesetText, type Item } from './items';
import { listKey, spanKey, strokeKeyBase, type StrokeFields } from './keys';
import { reapply } from './reapply';
import { LogState } from './state';
import type { Change } from './types';
import { arbCollision, arbEdited, arbPair, arbRuleset } from './test/arbitraries';
import {
  bandsW,
  doc,
  first,
  fund,
  input,
  last,
  open,
  painted,
  ruleset,
  span,
  transit
} from './test/fixtures';

const tipOf = (z: unknown[], m: unknown[] = []) =>
  LogState.of(ruleset(doc(z as never[], [], m as never[])), null);

const keysOf = (s: LogState) =>
  [...(s as unknown as { items: Map<string, Item> }).items.keys()].sort();

describe('reapply', () => {
  it('keeps everything when the tip is the state the changes were made on', () => {
    fc.assert(
      fc.property(arbPair, ([a, b]) => {
        const changes = diff(a, b);
        fc.pre(changes.length > 0);
        expect(reapply(LogState.of(a, null), input(changes))).toEqual({
          ok: true,
          changes,
          dropped: []
        });
      })
    );
  });

  it('keeps everything from an edit of the tip', () => {
    fc.assert(
      fc.property(
        arbRuleset.chain((a) => fc.tuple(fc.constant(a), arbEdited(a))),
        ([a, b]) => {
          const changes = diff(a, b);
          fc.pre(changes.length > 0);
          expect(reapply(LogState.of(a, null), input(changes))).toEqual({
            ok: true,
            changes,
            dropped: []
          });
        }
      )
    );
  });

  it('drops a change whose item is gone, and the rest stands', () => {
    const changes: Change[] = [
      { op: 'set', key: 'p:z1', field: 'label', value: 'Metro' },
      { op: 'set', key: 'sim', field: 'name', value: 'Mission' }
    ];
    const out = reapply(tipOf([]), input(changes));
    expect(out).toEqual({
      ok: true,
      changes: [changes[1]],
      dropped: [{ index: 0, change: changes[0], why: 'gone' }]
    });
  });

  it('drops a commit left with no changes', () => {
    const out = reapply(tipOf([]), input([{ op: 'delete', key: 'p:z1' }]));
    expect(out).toMatchObject({ ok: false, why: 'empty' });
  });

  it('drops an add whose parent is gone', () => {
    const add: Change = {
      op: 'add',
      key: spanKey('z1', first(3)),
      shape: 'span.transit',
      fields: { policy: 'z1', from: first(3), to: null, what: bandsW() }
    };
    expect(reapply(tipOf([]), input([add]))).toEqual({
      ok: false,
      why: 'empty',
      dropped: [{ index: 0, change: add, why: 'gone' }]
    });
  });

  it('re-anchors an add whose sibling is gone', () => {
    const add = {
      op: 'add',
      key: 'p:z3',
      shape: 'policy.category',
      after: 'p:z1',
      fields: {
        id: 'z3',
        kind: 'zoning',
        where: { tag: 'category', category: 'historic' },
        label: '',
        preset: null,
        on: true
      }
    } as const;
    const out = reapply(tipOf([painted('z2')]), input([add]));
    expect(out).toEqual({ ok: true, changes: [{ ...add, after: 'p:z2' }], dropped: [] });
  });

  it('drops a stroke another tab already added', () => {
    const tip = tipOf([painted('z2')]);
    const [k] = tip.list(listKey(spanKey('z2', first(1))));
    const again = {
      op: 'add',
      key: k,
      shape: 'stroke',
      fields: tip.item(k)!.fields,
      after: null
    } as const;
    const out = reapply(tip, input([again]));
    expect(out).toMatchObject({ ok: false, why: 'empty', dropped: [{ why: 'exists' }] });
  });

  it('drops an end that no longer shortens the span', () => {
    const tip = tipOf([transit('z1', [span(first(1), last(3), bandsW())])]);
    const out = reapply(tip, input([{ op: 'end', key: spanKey('z1', first(1)), to: last(6) }]));
    expect(out).toMatchObject({ ok: false, why: 'empty', dropped: [{ why: 'not-truncation' }] });
  });

  it('drops a commit that no longer folds to a valid ruleset', () => {
    const tip = tipOf([], [fund('f1', 'u-pool-1')]);
    const other = fund('f2', 'u-pool-1');
    const { spans, ...pf } = other;
    const changes: Change[] = [
      {
        op: 'add',
        key: 'p:f2',
        shape: 'policy.fund',
        fields: { ...pf, kind: 'money' },
        after: 'p:f1'
      },
      {
        op: 'add',
        key: spanKey('f2', spans[0].from),
        shape: 'span.fund',
        fields: { policy: 'f2', ...spans[0] }
      }
    ];
    expect(reapply(tip, input(changes))).toMatchObject({ ok: false, why: 'invalid' });
  });

  it.each([
    ['every change would be dropped as gone', [{ op: 'delete', key: 'p:z9' }]],
    ['it has a set', [{ op: 'set', key: 'p:z1', field: 'on', value: false }]]
  ])('throws future-shapes for a newer shape revision when %s', (_, changes) => {
    const tip = tipOf([transit('z1')]);
    const before = rulesetText(tip.ruleset());
    expect(() => reapply(tip, input(changes as Change[], { shapes: 2 }))).toThrow(
      expect.objectContaining({ code: 'future-shapes' })
    );
    expect(rulesetText(tip.ruleset())).toBe(before);
  });

  it('never changes the tip', () => {
    const tip = tipOf([transit('z1')]);
    const before = rulesetText(tip.ruleset());
    reapply(tip, input([{ op: 'delete', key: 'p:z1' }]));
    expect(rulesetText(tip.ruleset())).toBe(before);
  });

  it('keeps a commit that is valid only as a whole (a truncation and a later span)', () => {
    const tip = tipOf([transit('z1')]);
    const changes: Change[] = [
      {
        op: 'add',
        key: spanKey('z1', first(4)),
        shape: 'span.transit',
        fields: { policy: 'z1', from: first(4), to: null, what: bandsW(8) }
      },
      { op: 'end', key: spanKey('z1', first(1)), to: last(3) }
    ];
    expect(reapply(tip, input(changes))).toEqual({ ok: true, changes, dropped: [] });
  });

  describe('moves', () => {
    it('re-anchors a move whose anchor is gone to the last other key', () => {
      const out = reapply(
        tipOf([transit('z1'), painted('z2')]),
        input([{ op: 'move', key: 'p:z1', after: 'p:z5' }])
      );
      expect(out).toEqual({
        ok: true,
        changes: [{ op: 'move', key: 'p:z1', after: 'p:z2' }],
        dropped: []
      });
    });

    it('drops a move whose anchor is gone and that is alone in its list', () => {
      const move: Change = { op: 'move', key: 'p:z1', after: 'p:z5' };
      expect(reapply(tipOf([transit('z1')]), input([move]))).toEqual({
        ok: false,
        why: 'empty',
        dropped: [{ index: 0, change: move, why: 'no-op' }]
      });
    });
  });

  describe('strokes', () => {
    const sp = spanKey('z2', first(1));
    const P1: [number, number][] = [[-122.4, 37.7]];
    const P2: [number, number][] = [[-122.41, 37.71]];
    const P3: [number, number][] = [[-122.45, 37.76]];
    const sf = (brush: string, path: [number, number][], stories = 5): StrokeFields => ({
      span: sp,
      brush,
      kind: 'paint',
      stories,
      path,
      radiusM: 50
    });
    const add = (f: StrokeFields, after: string | null, key = strokeKeyBase(f)) =>
      ({ op: 'add', key, shape: 'stroke', fields: { ...f }, after }) as const;
    type B = { id: string; paths: [number, number][][]; stories?: number };
    /** A tip whose span z2 holds these brushes. */
    const tipWith = (...bs: B[]) =>
      tipOf([
        painted('z2', [
          open({
            tag: 'brushes',
            brushes: bs.map((b) => ({
              id: b.id,
              kind: 'paint',
              stories: b.stories ?? 5,
              strokes: b.paths.map((path) => ({ path, radiusM: 50 }))
            }))
          })
        ])
      ]);
    const X = strokeKeyBase(sf('b1', P1));
    const Y = strokeKeyBase(sf('b1', P2));
    const W = strokeKeyBase(sf('b2', P3, 9));

    it('rewrites k:X~2 to k:X when another writer deleted k:X', () => {
      const tip = tipWith({ id: 'b1', paths: [P2] });
      const out = reapply(tip, input([add(sf('b1', P1), X, `${X}~2`)]));
      const changes = [add(sf('b1', P1), Y, X)];
      expect(out).toEqual({ ok: true, changes, dropped: [] });
      const s = tip.clone();
      s.apply(input(changes), { check: true });
      expect(s.list(listKey(sp))).toEqual([Y, X]);
    });

    it('carries a rewritten key into the changes after it', () => {
      const tip = tipWith({ id: 'b1', paths: [P2] });
      const out = reapply(
        tip,
        input([
          add(sf('b1', P1), X, `${X}~2`),
          add(sf('b1', P3), `${X}~2`),
          { op: 'delete', key: X }
        ])
      );
      expect(out).toEqual({
        ok: true,
        changes: [add(sf('b1', P1), Y, X), add(sf('b1', P3), X)],
        dropped: [{ index: 2, change: { op: 'delete', key: X }, why: 'gone' }]
      });
    });

    it('lands a stroke whose anchor was deleted after the last stroke of its brush', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P2] }, { id: 'b2', paths: [P3], stories: 9 });
      const out = reapply(tip, input([add(sf('b1', P3), 'k:gone')]));
      expect(out).toEqual({ ok: true, changes: [add(sf('b1', P3), Y)], dropped: [] });
    });

    it('lands a stroke of a new brush whose anchor was deleted last in the span', () => {
      const tip = tipWith({ id: 'b1', paths: [P1] }, { id: 'b2', paths: [P3], stories: 9 });
      const f = sf('b3', P2, 4);
      const out = reapply(tip, input([add(f, 'k:gone')]));
      expect(out).toEqual({ ok: true, changes: [add(f, W)], dropped: [] });
    });

    it('re-anchors a stroke move after the last other stroke of its brush', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P2] }, { id: 'b2', paths: [P3], stories: 9 });
      const out = reapply(tip, input([{ op: 'move', key: X, after: 'k:gone' }]));
      expect(out).toEqual({
        ok: true,
        changes: [{ op: 'move', key: X, after: Y }],
        dropped: []
      });
    });

    it('drops the whole commit when its only surviving change breaks stroke order', () => {
      const tip = tipWith({ id: 'b1', paths: [P1] }, { id: 'b2', paths: [P3], stories: 9 });
      const before = rulesetText(tip.ruleset());
      const gone: Change = { op: 'delete', key: 'k:gone' };
      const out = reapply(tip, input([gone, add(sf('b1', P2), W)]));
      expect(out).toEqual({
        ok: false,
        why: 'invalid',
        dropped: [{ index: 0, change: gone, why: 'gone' }]
      });
      expect(rulesetText(tip.ruleset())).toBe(before);
      expect(tip.list(listKey(sp))).toEqual([X, W]);
    });

    it('keeps a commit that deletes a lower repeat and then the higher one', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P1] }, { id: 'b2', paths: [P3], stories: 9 });
      const changes: Change[] = [
        { op: 'delete', key: X },
        { op: 'delete', key: `${X}~2` }
      ];
      expect(reapply(tip, input(changes))).toEqual({ ok: true, changes, dropped: [] });
    });

    const del = (key: string): Change => ({ op: 'delete', key });

    it('retargets a delete of k:X to the highest repeat another writer added', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P1] });
      expect(reapply(tip, input([del(X)]))).toEqual({
        ok: true,
        changes: [del(`${X}~2`)],
        dropped: []
      });
    });

    it('retargets a delete of a middle repeat to the highest', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P1, P1] });
      expect(reapply(tip, input([del(`${X}~2`)]))).toEqual({
        ok: true,
        changes: [del(`${X}~3`)],
        dropped: []
      });
    });

    it('drops as gone the deletes below repeat 1', () => {
      const tip = tipWith({ id: 'b1', paths: [P1] });
      expect(reapply(tip, input([del(X), del(`${X}~2`)]))).toEqual({
        ok: true,
        changes: [del(X)],
        dropped: [{ index: 0, change: del(X), why: 'gone' }]
      });
    });

    it('places the deletes of two groups in one commit each against its own group', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P1, P1, P2, P2] });
      const out = reapply(tip, input([del(X), del(Y), del(`${X}~2`)]));
      expect(out).toEqual({
        ok: true,
        changes: [del(`${X}~2`), del(`${Y}~2`), del(`${X}~3`)],
        dropped: []
      });
    });

    it('drops two of three deletes as gone on a tip with one repeat, and keeps the last', () => {
      const tip = tipWith({ id: 'b1', paths: [P1] });
      expect(reapply(tip, input([del(X), del(`${X}~2`), del(`${X}~3`)]))).toEqual({
        ok: true,
        changes: [del(X)],
        dropped: [
          { index: 0, change: del(X), why: 'gone' },
          { index: 1, change: del(`${X}~2`), why: 'gone' }
        ]
      });
    });

    it('retargets past a different stroke between the repeats', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P2, P1] });
      expect(reapply(tip, input([del(X)]))).toEqual({
        ok: true,
        changes: [del(`${X}~2`)],
        dropped: []
      });
    });

    it('does not read a ~1 suffix as a repeat', () => {
      const tip = tipWith({ id: 'b1', paths: [P1, P1] });
      expect(reapply(tip, input([del(`${X}~1`)]))).toEqual({
        ok: false,
        why: 'empty',
        dropped: [{ index: 0, change: del(`${X}~1`), why: 'gone' }]
      });
    });

    it('drops the whole commit when a stroke disagrees with its brush', () => {
      const tip = tipWith({ id: 'b1', paths: [P1] });
      const out = reapply(tip, input([add(sf('b1', P2, 9), X)]));
      expect(out).toEqual({ ok: false, why: 'invalid', dropped: [] });
    });
  });

  it('returns changes the new tip accepts as one commit, or drops it and leaves the tip', () => {
    const kinds = ['zoning', 'permitting', 'money'].map(listKey);
    fc.assert(
      fc.property(arbCollision, ([base, theirs, mine]) => {
        expect(checkRuleset({ ...theirs, datasetVersion: null })).toBeNull();
        expect(checkRuleset({ ...mine, datasetVersion: null })).toBeNull();
        const tip = LogState.of(base, null);
        tip.apply(input(diff(base, theirs)));
        const before = rulesetText(tip.ruleset());
        const out = reapply(tip, input(diff(base, mine)));
        expect(rulesetText(tip.ruleset())).toBe(before);
        if (!out.ok) return;
        for (const c of out.changes) if ('after' in c) expect(c.after).not.toBeUndefined();
        const s = tip.clone();
        s.apply(input(out.changes));
        const flat = flatten(s.ruleset());
        expect(keysOf(s)).toEqual([...flat.items.keys()].sort());
        for (const k of [...kinds, ...keysOf(s).map(listKey)])
          expect(s.list(k)).toEqual(flat.lists.get(k) ?? []);
        expect(checkRuleset(s.ruleset())).toBeNull();
      }),
      { numRuns: 1000 }
    );
  });
});
