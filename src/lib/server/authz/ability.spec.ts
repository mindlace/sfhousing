import { describe, expect, it } from 'vitest';
import { abilityDominates, ROLE_BUNDLE, WILDCARD } from './ability';

describe('abilityDominates', () => {
  it('wildcard dominates anything', () => {
    expect(abilityDominates(WILDCARD, 'sim.write')).toBe(true);
    expect(abilityDominates(WILDCARD, 'role.manager')).toBe(true);
  });

  it('exact match dominates', () => {
    expect(abilityDominates('sim.write', 'sim.write')).toBe(true);
  });

  it('a namespace wildcard dominates members of the namespace', () => {
    expect(abilityDominates('sim.*', 'sim.read')).toBe(true);
    expect(abilityDominates('sim.*', 'member.manage')).toBe(false);
  });

  it('a higher role bundle dominates a lower bundle', () => {
    expect(abilityDominates(ROLE_BUNDLE.manager, ROLE_BUNDLE.editor)).toBe(true);
    expect(abilityDominates(ROLE_BUNDLE.editor, ROLE_BUNDLE.viewer)).toBe(true);
  });

  it('a lower role bundle does NOT dominate a higher bundle', () => {
    expect(abilityDominates(ROLE_BUNDLE.viewer, ROLE_BUNDLE.editor)).toBe(false);
    expect(abilityDominates(ROLE_BUNDLE.editor, ROLE_BUNDLE.manager)).toBe(false);
  });

  it('a role bundle dominates the fine abilities it expands to', () => {
    expect(abilityDominates('role.editor', 'sim.write')).toBe(true);
    expect(abilityDominates('role.viewer', 'sim.read')).toBe(true);
    expect(abilityDominates('role.manager', 'member.manage')).toBe(true);
    expect(abilityDominates('role.manager', 'invite.manage')).toBe(true);
  });

  it('a role bundle does NOT dominate fine abilities above its tier', () => {
    expect(abilityDominates('role.viewer', 'sim.write')).toBe(false);
    expect(abilityDominates('role.editor', 'member.manage')).toBe(false);
    expect(abilityDominates('role.editor', 'invite.manage')).toBe(false);
  });

  it('the bundles expand to exactly the documented abilities', () => {
    const all = ['sim.read', 'sim.write', 'member.manage', 'invite.manage'];
    const held = (b: string) => all.filter((a) => abilityDominates(b, a));
    expect(held(ROLE_BUNDLE.viewer)).toEqual(['sim.read']);
    expect(held(ROLE_BUNDLE.editor)).toEqual(['sim.read', 'sim.write']);
    expect(held(ROLE_BUNDLE.manager)).toEqual(all);
  });

  it('unrelated abilities do not dominate', () => {
    expect(abilityDominates('cap.grant', 'sim.read')).toBe(false);
    expect(abilityDominates('sim.read', 'sim.write')).toBe(false);
  });

  it('the wildcard target is not dominated by a bundle or namespace wildcard', () => {
    expect(abilityDominates(ROLE_BUNDLE.manager, WILDCARD)).toBe(false);
    expect(abilityDominates('sim.*', WILDCARD)).toBe(false);
  });
});
