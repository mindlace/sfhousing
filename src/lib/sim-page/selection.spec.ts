// The selection on /sim: the schema 3 dock's (TransitTab, until it goes), and on the timeline a
// policy by id: the limits view it chooses and what a tap on a lot selects.
import { describe, expect, it } from 'vitest';
import type { LimitOwner } from '$lib/sim/levers/source';
import { monthFirstDay } from '$lib/sim/world/months';
import type { PolicyLimitOwner } from '$lib/sim/world/policy/limits';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { fixedRef } from '$lib/timeline/rows';
import { DEFAULT_POLICY, type SimPolicy } from './policy';
import { limitsViewOf, liveSelection, selectionForLot } from './selection';

const policy: SimPolicy = {
  ...DEFAULT_POLICY,
  rules: [{ id: 'r1', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 8 }] }],
  custom: [
    { id: 'b1', kind: 'paint', strokes: [{ path: [[-122.4, 37.7]], radiusM: 30 }], stories: 6 }
  ]
};

describe('liveSelection', () => {
  it('keeps a rule or a painted area still in the policy', () => {
    expect(liveSelection({ kind: 'rule', id: 'r1' }, policy)).toEqual({ kind: 'rule', id: 'r1' });
    expect(liveSelection({ kind: 'paint', id: 'b1' }, policy)).toEqual({ kind: 'paint', id: 'b1' });
  });

  it('drops one that is gone, and keeps null', () => {
    expect(liveSelection({ kind: 'rule', id: 'r2' }, policy)).toBeNull();
    expect(liveSelection({ kind: 'paint', id: 'b2' }, policy)).toBeNull();
    expect(liveSelection(null, policy)).toBeNull();
  });

  it('keeps the FZP baseline: it never leaves the policy', () => {
    expect(liveSelection({ kind: 'fzp' }, policy)).toEqual({ kind: 'fzp' });
    expect(liveSelection({ kind: 'fzp' }, DEFAULT_POLICY)).toEqual({ kind: 'fzp' });
  });

  it('does not take a rule id for a painted area or the reverse', () => {
    expect(liveSelection({ kind: 'paint', id: 'r1' }, policy)).toBeNull();
    expect(liveSelection({ kind: 'rule', id: 'b1' }, policy)).toBeNull();
  });
});

const AS_OF = 20_000;
const M = (m: number) => monthFirstDay(AS_OF, m);
const transit: Policy = {
  id: 'near-bart',
  label: 'Taller near BART',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [{ from: M(1), to: null, what: { tag: 'bands', bands: [{ maxM: 400, stories: 8 }] } }]
};
const painted: Policy = {
  id: 'mission',
  label: 'Mission paint',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [
    { from: M(1), to: M(13) - 1, what: { tag: 'brushes', brushes: [] } },
    { from: M(13), to: null, what: { tag: 'brushes', brushes: [] } }
  ]
};
const doc: SimPolicy4 = {
  schema: 4,
  kinds: { zoning: [transit, painted], permitting: [], money: [] }
};
const asLimit = (o: PolicyLimitOwner): LimitOwner => o as unknown as LimitOwner;

describe('limitsViewOf', () => {
  it('a selected transit policy gives rule mode on its id, winning over the tool', () => {
    expect(
      limitsViewOf({ kind: 'zoning', id: 'near-bart', span: 0 }, doc, 'paint', 'edit')
    ).toEqual({ kind: 'rule', ruleId: 'near-bart' });
  });

  it('the fixed zoning row gives fzp mode, winning over the tool', () => {
    expect(limitsViewOf(fixedRef('zoning'), doc, 'erase', 'edit')).toEqual({ kind: 'fzp' });
  });

  it('a painted policy, or Paint or Erase in edit, gives paint mode', () => {
    expect(limitsViewOf({ kind: 'zoning', id: 'mission', span: 1 }, doc, 'move', 'edit')).toEqual({
      kind: 'paint'
    });
    expect(limitsViewOf(null, doc, 'paint', 'edit')).toEqual({ kind: 'paint' });
    expect(limitsViewOf(null, doc, 'erase', 'edit')).toEqual({ kind: 'paint' });
  });

  it('Move, another kind, a policy gone, or the view with a tool chosen, gives plain', () => {
    expect(limitsViewOf(null, doc, 'move', 'edit')).toEqual({ kind: 'plain' });
    expect(limitsViewOf(null, doc, 'paint', 'view')).toEqual({ kind: 'plain' });
    expect(limitsViewOf({ kind: 'zoning', id: 'gone', span: 0 }, doc, 'move', 'edit')).toEqual({
      kind: 'plain'
    });
    expect(limitsViewOf(fixedRef('money'), doc, 'move', 'edit')).toEqual({ kind: 'plain' });
  });
});

describe('selectionForLot', () => {
  it("selects the owner's policy on the span covering the playhead's day", () => {
    const o = asLimit({ kind: 'paint', policy: 'mission' });
    expect(selectionForLot(o, 'L1', doc, M(14))).toEqual({
      kind: 'zoning',
      id: 'mission',
      span: 1
    });
    expect(selectionForLot(o, 'L1', doc, M(2))).toEqual({ kind: 'zoning', id: 'mission', span: 0 });
    const r = asLimit({ kind: 'rule', ruleId: 'near-bart', policy: 'near-bart' });
    expect(selectionForLot(r, 'L1', doc, M(2))).toEqual({
      kind: 'zoning',
      id: 'near-bart',
      span: 0
    });
  });

  it('with no span covering the day (or the policy off), its first span', () => {
    const off: SimPolicy4 = {
      ...doc,
      kinds: { ...doc.kinds, zoning: [{ ...painted, on: false }] }
    };
    const o = asLimit({ kind: 'paint', policy: 'mission' });
    expect(selectionForLot(o, 'L1', off, M(14))).toEqual({
      kind: 'zoning',
      id: 'mission',
      span: 0
    });
  });

  it('the plan, or a policy no longer in the document, selects the fixed zoning row', () => {
    expect(selectionForLot(asLimit({ kind: 'fzp' }), 'L1', doc, M(2))).toEqual(fixedRef('zoning'));
    const gone = asLimit({ kind: 'paint', policy: 'gone' });
    expect(selectionForLot(gone, 'L1', doc, M(2))).toEqual(fixedRef('zoning'));
  });

  it('no lot, or a lot without an owner, clears the selection', () => {
    expect(selectionForLot(null, null, doc, M(2))).toBeNull();
    expect(selectionForLot(asLimit({ kind: 'fzp' }), null, doc, M(2))).toBeNull();
    expect(selectionForLot(null, 'L1', doc, M(2))).toBeNull();
  });
});
