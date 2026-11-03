// The dock's one selection (a rule or a painted area) and the limits view it chooses.
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type SimPolicy } from './policy';
import { limitsViewOf, liveSelection } from './selection';

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
