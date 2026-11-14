import { and, asc, eq, inArray, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { account, passkey, session, user, userIdentity } from '$lib/server/db/schema';
import { STRONG_PROVIDERS } from '$lib/server/user-store/auth-factors';

/**
 * Pseudonymous accounts eligible for reaping, oldest-expiry-first, capped at `limit`.
 * Eligible = pseudonymous (user.isAnonymous) ∧ live identity (not tombstoned, not fused)
 * ∧ not durable (no passkey, no password/Google account) ∧ every session expired more
 * than `graceMs` before `now` (or no sessions at all — unreachable by construction).
 */
export async function selectReapableUsers(
  db: Database,
  now: number,
  graceMs: number,
  limit: number
): Promise<{ liveUserId: string; identityId: string }[]> {
  const cutoff = now - graceMs;
  // Latest session expiry per user, in epoch ms (NULL when the user has no sessions).
  const latestExpiry = sql<number | null>`(
    select max(${session.expiresAt}) from ${session} where ${session.userId} = ${user.id}
  )`;
  const rows = await db
    .select({ liveUserId: user.id, identityId: user.userIdentity, latest: latestExpiry })
    .from(user)
    .innerJoin(userIdentity, eq(userIdentity.id, user.userIdentity))
    .where(
      and(
        eq(user.isAnonymous, true),
        isNull(userIdentity.deletedAt),
        isNull(userIdentity.supersededById),
        // not durable: no passkey
        notExists(
          db
            .select({ x: sql`1` })
            .from(passkey)
            .where(eq(passkey.userId, user.id))
        ),
        // not durable: no password or Google account
        notExists(
          db
            .select({ x: sql`1` })
            .from(account)
            .where(
              and(eq(account.userId, user.id), inArray(account.providerId, [...STRONG_PROVIDERS]))
            )
        ),
        // all sessions expired past grace, or no sessions at all
        or(isNull(latestExpiry), lt(latestExpiry, cutoff))
      )
    )
    .orderBy(asc(latestExpiry))
    .limit(limit);
  return rows.map((r) => ({ liveUserId: r.liveUserId, identityId: r.identityId }));
}
