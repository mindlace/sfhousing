import { describe, it, expect } from 'vitest';
import { ROLE_BUNDLE, simCaps } from './index';

describe('simCaps', () => {
  it('lifts a role to a single bundle cap on the sim', () => {
    expect(simCaps('editor', 's1')).toEqual([
      { ability: ROLE_BUNDLE.editor, resource: { type: 'sim', id: 's1' } }
    ]);
  });
  it('returns [] for a null role (non-member)', () => {
    expect(simCaps(null, 's1')).toEqual([]);
  });
});
