// The dock's one selection (a rule or a painted area) and the limits view it chooses.
import { describe, expect, it } from 'vitest';
import type { LimitOwner } from '$lib/sim/levers/source';
import { DEFAULT_POLICY, customQuery, queryKey, type Lots, type SimPolicy } from './policy';
import { limitsViewOf, liveSelection, ownerLabel, selectionForLot, tabOf } from './selection';

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

describe('limitsViewOf', () => {
  it('a selected rule gives rule mode, winning over the tool', () => {
    expect(limitsViewOf({ kind: 'rule', id: 'r1' }, 'paint', 'edit')).toEqual({
      kind: 'rule',
      ruleId: 'r1'
    });
  });

  it('the FZP baseline gives fzp mode, winning over the tool', () => {
    expect(limitsViewOf({ kind: 'fzp' }, 'move', 'edit')).toEqual({ kind: 'fzp' });
    expect(limitsViewOf({ kind: 'fzp' }, 'erase', 'edit')).toEqual({ kind: 'fzp' });
  });

  it('a painted area, or Paint or Erase in edit, gives paint mode', () => {
    expect(limitsViewOf({ kind: 'paint', id: 'b1' }, 'move', 'edit')).toEqual({ kind: 'paint' });
    expect(limitsViewOf(null, 'paint', 'edit')).toEqual({ kind: 'paint' });
    expect(limitsViewOf(null, 'erase', 'edit')).toEqual({ kind: 'paint' });
  });

  it('Move, or the view with a tool chosen, gives plain', () => {
    expect(limitsViewOf(null, 'move', 'edit')).toEqual({ kind: 'plain' });
    expect(limitsViewOf(null, 'paint', 'view')).toEqual({ kind: 'plain' });
  });
});

describe('selectionForLot', () => {
  const k1 = queryKey(customQuery(policy.custom[0]));
  const lots: Lots = (k) => (k === k1 ? ['L1'] : undefined);

  it('a rule still in the policy selects that rule', () => {
    expect(selectionForLot({ kind: 'rule', ruleId: 'r1' }, 'L1', policy, lots)).toEqual({
      kind: 'rule',
      id: 'r1'
    });
  });

  it('a rule no longer in the policy (removed, or a stale answer) selects the FZP baseline', () => {
    expect(selectionForLot({ kind: 'rule', ruleId: 'r9' }, 'L1', policy, lots)).toEqual({
      kind: 'fzp'
    });
  });

  it('a missing or empty rule id selects the FZP baseline', () => {
    expect(selectionForLot({ kind: 'rule', ruleId: '' }, 'L1', policy, lots)).toEqual({
      kind: 'fzp'
    });
    const missing = { kind: 'rule', ruleId: undefined } as unknown as LimitOwner;
    expect(selectionForLot(missing, 'L1', policy, lots)).toEqual({ kind: 'fzp' });
  });

  it('paint selects the painted area holding the lot, else the FZP baseline', () => {
    expect(selectionForLot({ kind: 'paint' }, 'L1', policy, lots)).toEqual({
      kind: 'paint',
      id: 'b1'
    });
    expect(selectionForLot({ kind: 'paint' }, 'L2', policy, lots)).toEqual({ kind: 'fzp' });
    expect(selectionForLot({ kind: 'paint' }, 'L1', policy, () => undefined)).toEqual({
      kind: 'fzp'
    });
  });

  it('fzp selects the FZP baseline', () => {
    expect(selectionForLot({ kind: 'fzp' }, 'L1', policy, lots)).toEqual({ kind: 'fzp' });
  });

  it('no lot, or a lot without an owner, clears the selection', () => {
    expect(selectionForLot(null, null, policy, lots)).toBeNull();
    expect(selectionForLot({ kind: 'fzp' }, null, policy, lots)).toBeNull();
    expect(selectionForLot(null, 'L1', policy, lots)).toBeNull();
  });
});

describe('ownerLabel', () => {
  const k1 = queryKey(customQuery(policy.custom[0]));
  const lots: Lots = (k) => (k === k1 ? ['L1'] : undefined);

  it('names a rule still in the policy by its layer name', () => {
    expect(ownerLabel({ kind: 'rule', ruleId: 'r1' }, 'L1', policy, lots)).toBe('Near Muni Metro');
  });

  it('gives null for a rule no longer in the policy, or with no id', () => {
    expect(ownerLabel({ kind: 'rule', ruleId: 'r9' }, 'L1', policy, lots)).toBeNull();
    expect(ownerLabel({ kind: 'rule', ruleId: '' }, 'L1', policy, lots)).toBeNull();
  });

  it('names paint by its story count', () => {
    expect(ownerLabel({ kind: 'paint' }, 'L1', policy, lots)).toBe('Painted 6 stories');
    const one: SimPolicy = { ...policy, custom: [{ ...policy.custom[0], stories: 1 } as never] };
    const k = queryKey(customQuery(one.custom[0]));
    expect(ownerLabel({ kind: 'paint' }, 'L1', one, (x) => (x === k ? ['L1'] : undefined))).toBe(
      'Painted 1 story'
    );
  });

  it('gives null for paint it cannot place (another lot, unknown lots)', () => {
    expect(ownerLabel({ kind: 'paint' }, 'L2', policy, lots)).toBeNull();
    expect(ownerLabel({ kind: 'paint' }, 'L1', policy, () => undefined)).toBeNull();
  });

  it('gives null for FZP', () => {
    expect(ownerLabel({ kind: 'fzp' }, 'L1', policy, lots)).toBeNull();
  });
});

describe('tabOf', () => {
  it('a rule and the FZP baseline live on Transit; a painted area on Paint', () => {
    expect(tabOf({ kind: 'rule', id: 'r1' })).toBe('transit');
    expect(tabOf({ kind: 'fzp' })).toBe('transit');
    expect(tabOf({ kind: 'paint', id: 'b1' })).toBe('paint');
  });
});
