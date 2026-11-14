import { describe, expect, it } from 'vitest';
import { authorize, holdsAnyOn, type Capability } from './authorize';
import { APP_RESOURCE } from './resource';
import { ROLE_BUNDLE, WILDCARD } from './ability';

const editorOn = (simId: string): Capability => ({
  ability: ROLE_BUNDLE.editor,
  resource: { type: 'sim', id: simId }
});
const viewerOn = (simId: string): Capability => ({
  ability: ROLE_BUNDLE.viewer,
  resource: { type: 'sim', id: simId }
});

describe('authorize', () => {
  it('allows when a held bundle covers the resource and dominates the ability', () => {
    const d = authorize([editorOn('s1')], {
      ability: 'sim.write',
      resource: { type: 'sim', id: 's1' }
    });
    expect(d).toEqual({ allow: true });
  });

  it('allows an app:* wildcard holder anything', () => {
    const wildcard: Capability = { ability: WILDCARD, resource: APP_RESOURCE };
    expect(
      authorize([wildcard], { ability: 'member.manage', resource: { type: 'sim', id: 's9' } })
    ).toEqual({
      allow: true
    });
  });

  it('forbids when the principal holds something on the resource but the ability is too low', () => {
    const d = authorize([viewerOn('s1')], {
      ability: 'sim.write',
      resource: { type: 'sim', id: 's1' }
    });
    expect(d).toEqual({ allow: false, reason: 'forbidden' });
  });

  it('returns not_found when the principal holds nothing on the resource', () => {
    const d = authorize([editorOn('s1')], {
      ability: 'sim.read',
      resource: { type: 'sim', id: 's2' }
    });
    expect(d).toEqual({ allow: false, reason: 'not_found' });
  });

  it('returns not_found for an empty capability set', () => {
    expect(authorize([], { ability: 'sim.read', resource: { type: 'sim', id: 's1' } })).toEqual({
      allow: false,
      reason: 'not_found'
    });
  });

  it('honors a capability held on an ancestor of the target', () => {
    const d = authorize([editorOn('s1')], {
      ability: 'sim.write',
      resource: { type: 'sim', id: 's2' },
      ancestors: [{ type: 'sim', id: 's1' }]
    });
    expect(d).toEqual({ allow: true });
  });

  it('continues past a held capability that covers but does not dominate', () => {
    const d = authorize([viewerOn('s1'), editorOn('s1')], {
      ability: 'sim.write',
      resource: { type: 'sim', id: 's1' }
    });
    expect(d).toEqual({ allow: true });
  });

  it('ignores caveats in Phase 1 (a populated caveat does not block authorization)', () => {
    const capped: Capability = { ...editorOn('s1'), caveats: { expiresAt: 0 } };
    const d = authorize([capped], {
      ability: 'sim.write',
      resource: { type: 'sim', id: 's1' }
    });
    expect(d).toEqual({ allow: true });
  });
});

describe('holdsAnyOn', () => {
  it('is true when a held capability covers the requested resource', () => {
    expect(
      holdsAnyOn([viewerOn('s1')], { ability: 'sim.write', resource: { type: 'sim', id: 's1' } })
    ).toBe(true);
  });

  it('is false when nothing covers the requested resource', () => {
    expect(
      holdsAnyOn([viewerOn('s1')], { ability: 'sim.read', resource: { type: 'sim', id: 's2' } })
    ).toBe(false);
  });
});
