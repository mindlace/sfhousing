import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { getRole } from '$lib/server/sims/sim-index';
import {
  authorize,
  simCaps,
  type Ability,
  type Capability,
  type ResourceRef
} from '$lib/server/authz';
import { PUBLIC_ACTOR_ID, type Actor, type ActorKind } from './actor';

/** The minimal request shape `requireCap` needs: the platform (for the D1 fold) and the
 *  resolved principal + app-scoped capability set populated in `hooks.server.ts`. */
export type CapEvent = {
  platform?: App.Platform;
  locals: { user: App.Locals['user']; capabilities: Capability[]; actorKind: ActorKind };
};

/**
 * Resolve the principal's capabilities RELEVANT TO `resource`. Null-user-safe (it can
 * be reached before any 401). `app` is the locals capability set; `sim` is membership-only.
 */
async function resolveResourceCaps(event: CapEvent, resource: ResourceRef): Promise<Capability[]> {
  if (resource.type === 'app') return event.locals.capabilities;
  const user = event.locals.user;
  if (!user) return []; // no principal → holds nothing on the sim (→ 404→401 ladder)
  const db = getDb(event.platform!);
  const role = await getRole({ db, simId: resource.id, userId: user.id });
  return simCaps(role, resource.id);
}

/**
 * The single request-facing authorization seam. Resolves the caps the principal holds
 * for `resource`, runs the pure `authorize()` matcher, then maps the decision:
 *  - ALLOW → return the caps + the actor (`human` when signed in, else a `public` actor).
 *  - DENY  → 401 (no principal) → 404 (holds nothing on a non-`app` resource; no
 *            enumeration) → 403 (holds something but not enough; and ALL app denials).
 */
export async function requireCap(
  event: CapEvent,
  ability: Ability,
  resource: ResourceRef,
  opts?: { caps?: Capability[] }
): Promise<{ caps: Capability[]; actor: Actor }> {
  const user = event.locals.user;

  const caps = opts?.caps ?? (await resolveResourceCaps(event, resource));
  const decision = authorize(caps, { ability, resource });

  if (decision.allow) {
    const actor: Actor = user
      ? { actorId: user.id, actorKind: event.locals.actorKind ?? 'human' }
      : { actorId: PUBLIC_ACTOR_ID, actorKind: 'public' };
    return { caps, actor };
  }

  if (!user) throw error(401, 'not signed in');
  if (resource.type !== 'app' && decision.reason === 'not_found')
    throw error(404, { message: 'not found', resource: 'sim' });
  throw error(403, 'forbidden');
}
