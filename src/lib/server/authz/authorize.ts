import { covers, type ResourceRef } from './resource';
import { abilityDominates, type Ability } from './ability';

/** Attenuation constraints. Shaped now, NOT enforced in Phase 1 (Phase 2 activates these). */
type Caveat = { expiresAt?: number };

/** A held capability: an ability over a resource, optionally attenuated. */
export type Capability = { ability: Ability; resource: ResourceRef; caveats?: Caveat };

export type AuthRequest = {
  ability: Ability;
  resource: ResourceRef;
  /** The target's containment chain (e.g. the sim a resource belongs to). Empty for app/sim. */
  ancestors?: ResourceRef[];
};

export type Decision = { allow: true } | { allow: false; reason: 'forbidden' | 'not_found' };

/**
 * Does the held set cover the request's RESOURCE at all (any ability)? Drives the
 * 404-vs-403 distinction in the wiring layer: nothing-on-the-resource → 404 (no
 * enumeration), something-but-not-enough → 403.
 */
export function holdsAnyOn(held: Capability[], req: AuthRequest): boolean {
  return held.some((c) => covers(c.resource, req.resource, req.ancestors ?? []));
}

/**
 * Pure authorization decision. ALLOW iff some held capability covers the requested
 * resource AND dominates the requested ability. (Caveats are inert in Phase 1.)
 * Otherwise `not_found` when the principal holds nothing on the resource, else
 * `forbidden`. Identity resolution and the 401 (no signed-in principal) live in the
 * wiring layer; this function is a pure function of (held, req) so the same matcher
 * serves both the central fold (now) and offline token verification (end state).
 */
export function authorize(held: Capability[], req: AuthRequest): Decision {
  const ancestors = req.ancestors ?? [];
  let coversSomething = false;
  for (const c of held) {
    if (covers(c.resource, req.resource, ancestors)) {
      coversSomething = true;
      if (abilityDominates(c.ability, req.ability)) return { allow: true };
    }
  }
  return { allow: false, reason: coversSomething ? 'forbidden' : 'not_found' };
}
