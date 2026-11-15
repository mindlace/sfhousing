import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePolicy4 } from '$lib/timeline/parse4';
import { simDoc4Problems } from '$lib/timeline/sim-doc4';
import { listKey, spanKey } from './keys';
import { assemble, flatten, rulesetText, toLogForm } from './items';
import { arbRuleset } from './test/arbitraries';
import { doc, first, open, painted, ruleset } from './test/fixtures';

describe('flatten and assemble', () => {
  it('flattens a painted policy into a policy, a span and ordered strokes', () => {
    const s1 = { path: [[-122.4, 37.7]], radiusM: 50 };
    const s2 = { path: [[-122.41, 37.71]], radiusM: 10 };
    const r = ruleset(
      doc([
        painted('z2', [
          open({
            tag: 'brushes',
            brushes: [
              { id: 'b1', kind: 'paint', strokes: [s1, s2], stories: 5 },
              { id: 'b2', kind: 'erase', strokes: [s1] }
            ]
          })
        ])
      ])
    );
    const { items, lists } = flatten(r);
    const sk = spanKey('z2', first(1));
    const strokes = lists.get(listKey(sk))!;
    expect([...items.keys()].slice(0, 3)).toEqual(['sim', 'p:z2', sk]);
    expect(lists.get(listKey('zoning'))).toEqual(['p:z2']);
    expect(strokes.map((k) => items.get(k)!.fields.brush)).toEqual(['b1', 'b1', 'b2']);
    expect(items.get(sk)!.fields.what).toEqual({ tag: 'brushes' });
  });
  it('assembles what it flattened, exactly', () => {
    fc.assert(
      fc.property(arbRuleset, (r) => {
        const { items, lists } = flatten(r);
        expect(rulesetText(assemble(items, lists))).toBe(rulesetText(r));
      })
    );
  });
  it('refuses an empty brush, which toLogForm drops', () => {
    const p = doc([
      painted('z2', [open({ tag: 'brushes', brushes: [{ id: 'b1', kind: 'erase', strokes: [] }] })])
    ]);
    expect(() => flatten(ruleset(p))).toThrow(RangeError);
    expect(toLogForm(p).kinds.zoning[0].spans[0].what).toEqual({ tag: 'brushes', brushes: [] });
  });
  it('draws only valid, log-form rulesets', () => {
    fc.assert(
      fc.property(arbRuleset, (r) => {
        expect(parsePolicy4(r.policy, { asOf: null, presetLayer: 'reconcile' })).toEqual(r.policy);
        expect(
          simDoc4Problems({
            schema: 4,
            kind: 'sim',
            datasetVersion: 'fixture-0',
            policy: r.policy
          })
        ).toEqual([]);
        expect(toLogForm(r.policy)).toEqual(r.policy);
      })
    );
  });
});
