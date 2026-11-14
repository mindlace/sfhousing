import { ROLE_BUNDLE } from './ability';
import type { Capability } from './authorize';

// Declared here until the schema task moves it to `$lib/server/db/schema/simControlPlane`.
export type SimMemberRole = 'manager' | 'editor' | 'viewer';

/** Lift a sim membership role into the single bundle capability it confers on that
 *  sim. `null` (non-member) → no capabilities. Membership-only: callers never mix in
 *  app-scoped caps for a sim check. Pure, so both the HTTP seam and other callers can
 *  import it without pulling SvelteKit. */
export function simCaps(role: SimMemberRole | null, simId: string): Capability[] {
  return role ? [{ ability: ROLE_BUNDLE[role], resource: { type: 'sim', id: simId } }] : [];
}
