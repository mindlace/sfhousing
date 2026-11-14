import { getDb } from '$lib/server/db';
import { getRole } from '$lib/server/sims/sim-index';
import { requireCap } from '$lib/server/authz/require-cap';
import { ROLE_BUNDLE, simCaps } from '$lib/server/authz';
import type { SimMemberRole } from '$lib/server/db/schema';
import type { Actor } from './actor';

/**
 * Worker-side authorization for a sim, now a thin wrapper over the unitary
 * `requireCap` seam (which runs the `authorize` matcher). The DO is per-sim and
 * cannot see global membership (that lives in D1), so authz happens here before any
 * sim RPC. Throws SvelteKit errors (propagates from `load` and `+server`): 401 (no
 * user) → 404 (not a member; no enumeration) → 403 (role below minimum). Role
 * minimums: reads = `viewer`, content/direct mutations = `editor`, membership = `manager`.
 *
 * Still folds the effective role itself (callers consume it to drive manager-only UI) and
 * passes the precomputed caps into `requireCap`, so there is no second fold.
 */
export async function requireSimRole(
  event: { platform?: App.Platform; locals: App.Locals },
  simId: string,
  minRole: SimMemberRole
): Promise<{ role: SimMemberRole; actor: Actor }> {
  const db = getDb(event.platform!);
  const role = event.locals.user
    ? await getRole({ db, simId, userId: event.locals.user.id })
    : null;
  const { actor } = await requireCap(
    event,
    ROLE_BUNDLE[minRole],
    { type: 'sim', id: simId },
    {
      caps: simCaps(role, simId)
    }
  );
  // `role` is non-null here: requireCap would have thrown 404 for a non-member.
  return { role: role as SimMemberRole, actor };
}
