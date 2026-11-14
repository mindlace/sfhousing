/** A dot-namespaced ability, e.g. `sim.write`. `*` is the wildcard. */
export type Ability = string;

/** The wildcard ability: dominates every ability. */
export const WILDCARD: Ability = '*';

/** Sim role → its named bundle ability. */
export const ROLE_BUNDLE = {
  manager: 'role.manager',
  editor: 'role.editor',
  viewer: 'role.viewer'
} as const;
export type RoleBundle = (typeof ROLE_BUNDLE)[keyof typeof ROLE_BUNDLE];

// Fine abilities each bundle expands to (manager ⊇ editor ⊇ viewer). `member.leave` is
// intentionally NOT here: leaving is a self-action, special-cased in the wiring layer,
// not a granted ability.
const VIEWER_ABILITIES = ['sim.read'] as const;
const EDITOR_ABILITIES = [...VIEWER_ABILITIES, 'sim.write'] as const;
const MANAGER_ABILITIES = [...EDITOR_ABILITIES, 'member.manage', 'invite.manage'] as const;

const BUNDLE_EXPANSION: Record<RoleBundle, readonly string[]> = {
  'role.viewer': VIEWER_ABILITIES,
  'role.editor': EDITOR_ABILITIES,
  'role.manager': MANAGER_ABILITIES
};

/** Bundle dominance rank: manager ⊇ editor ⊇ viewer. */
const BUNDLE_RANK: Record<RoleBundle, number> = {
  'role.viewer': 0,
  'role.editor': 1,
  'role.manager': 2
};

function isBundle(a: string): a is RoleBundle {
  return a === 'role.viewer' || a === 'role.editor' || a === 'role.manager';
}

/**
 * Does holding `held` satisfy a requirement to exercise `target`?
 *  - `*` dominates everything.
 *  - exact match dominates.
 *  - namespace wildcard: `sim.*` dominates `sim.read`.
 *  - role bundles: a higher bundle dominates a lower bundle, and any bundle
 *    dominates each fine ability in its expansion.
 *  - otherwise only exact match (handled above) counts.
 */
export function abilityDominates(held: Ability, target: Ability): boolean {
  if (held === WILDCARD) return true;
  if (held === target) return true;

  if (held.endsWith('.*')) {
    const ns = held.slice(0, -1); // 'sim.*' → 'sim.'
    if (target.startsWith(ns)) return true;
  }

  if (isBundle(held)) {
    if (isBundle(target)) return BUNDLE_RANK[held] >= BUNDLE_RANK[target];
    return BUNDLE_EXPANSION[held].includes(target);
  }

  return false;
}
