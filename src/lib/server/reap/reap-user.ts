import type { Actor } from '$lib/server/authz/actor';
import type { Database } from '$lib/server/db';
import { deleteAccount } from '$lib/server/user-store/deletion';
import { selectReapableUsers } from './eligibility';
import { REAP_GRACE_MS } from './config';

/** The reaper's system actor, for attributing reap-time removals. */
export const REAP_ACTOR: Actor = { actorId: 'system:reaper', actorKind: 'automation' };

/**
 * Reap one pseudonymous account. Re-verifies eligibility at execution time (the
 * dispatch-to-execute gap is async: the user may have signed back in, added a
 * credential, or been deleted since selection), then closes the account.
 * Idempotent: no-longer-eligible gives { reaped: false }.
 */
export async function reapUser(db: Database, liveUserId: string): Promise<{ reaped: boolean }> {
  const eligible = await selectReapableUsers(db, Date.now(), REAP_GRACE_MS, 1_000_000);
  const hit = eligible.find((e) => e.liveUserId === liveUserId);
  if (!hit) return { reaped: false };
  await deleteAccount({ db, identityId: hit.identityId, actor: REAP_ACTOR });
  return { reaped: true };
}
