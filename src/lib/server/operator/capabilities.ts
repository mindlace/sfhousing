import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { capabilityEvent, userIdentity } from '$lib/server/db/schema';
import type { User } from '$lib/server/user-store/user';
import { survivorId } from '$lib/server/user-store/user';
import {
  authorize,
  APP_RESOURCE,
  type Ability,
  type Capability,
  type ResourceRef,
  type ResourceType
} from '$lib/server/authz';
import { foldRevokeWins } from '$lib/server/event-log/fold';
import { OPERATOR_ABILITIES } from './registry';

/** Parse the comma-separated BOOTSTRAP_EMAILS into a normalized lowercase set. */
function bootstrapEmailSet(config: string | undefined): Set<string> {
  if (!config) return new Set();
  return new Set(
    config
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * A user is a bootstrap operator iff their VERIFIED, non-pseudonymous email is allowlisted.
 * A pseudonymous account's synthetic address never qualifies.
 */
export function isBootstrapEmail(user: User, config: string | undefined): boolean {
  if (user.pseudonymous || !user.emailVerified) return false;
  return bootstrapEmailSet(config).has(user.email.trim().toLowerCase());
}

/**
 * The DB-folded capability set for an identity (NO env-bootstrap logic). Folds
 * capability_event latest-wins per (resourceType, resourceId, ability) across the
 * survivor id and any identity fused into it. Unknown identity → empty array (safe).
 */
export async function resolveGrantedCapabilities(
  db: Database,
  identityId: string
): Promise<Capability[]> {
  const sid = (await survivorId(db, identityId)) ?? identityId;
  const fusedIn = await db
    .select({ id: userIdentity.id })
    .from(userIdentity)
    .where(eq(userIdentity.supersededById, sid));
  const ids = [sid, ...fusedIn.map((r) => r.id)];
  return resolveCapsFor(db, ids);
}

/**
 * The effective capability set for a user. Bootstrap emails resolve to a single
 * app-wide wildcard capability with no DB read; otherwise fold the ledger across the
 * survivor id AND every identity fused into it.
 */
export async function resolveCapabilities(
  db: Database,
  user: User,
  bootstrapEmails: string | undefined
): Promise<Capability[]> {
  if (isBootstrapEmail(user, bootstrapEmails)) return [{ ability: '*', resource: APP_RESOURCE }];
  return resolveGrantedCapabilities(db, user.id);
}

/** Does the held set satisfy an APP-scoped `ability`? (Operator caps are all `app:*`.) */
export function hasCapability(held: Capability[], ability: Ability): boolean {
  return authorize(held, { ability, resource: APP_RESOURCE }).allow;
}

/** True if `held` carries any operator capability (bootstrap `*` dominates all). */
export function isOperator(held: Capability[]): boolean {
  return OPERATOR_ABILITIES.some((ability) => hasCapability(held, ability));
}

/**
 * Throw 401/403 unless the locals capability set holds the app-scoped `ability`.
 * The synchronous, app-only specialization of `requireCap` (../authz/require-cap.ts):
 * app caps are pre-resolved in `locals` (no D1 fold needed) and every denial maps to
 * 403 — operator endpoints don't hide existence, matching `requireCap`'s `app` path.
 * Shares the one `authorize` matcher via `hasCapability`.
 */
export function requireCapability(
  locals: { capabilities: Capability[]; user: User | null },
  ability: Ability
): void {
  if (!locals.user) throw error(401, 'not signed in');
  if (!hasCapability(locals.capabilities, ability)) throw error(403, 'insufficient capability');
}

/** Throw 401/403 unless the locals capability set holds ANY operator ability. */
export function requireOperator(locals: { capabilities: Capability[]; user: User | null }): void {
  if (!locals.user) throw error(401, 'not signed in');
  if (!isOperator(locals.capabilities)) throw error(403, 'insufficient capability');
}

/**
 * The ONE ledger fold. Folds `capability_event` for an explicit `principalSet` (last-write-wins
 * by createdAt; on an EQUAL createdAt, REVOKE wins — fail-safe / least-privilege). With `scope`,
 * pre-filters to that single resource in SQL and keys by ability; without `scope`, folds across
 * all resources and keys by (resourceType, resourceId, ability). Callers build the principal set
 * (identity fuse-union). Empty `principalSet` → [] (no SQL).
 */
export async function resolveCapsFor(
  db: Database,
  principalSet: string[],
  scope?: ResourceRef
): Promise<Capability[]> {
  if (principalSet.length === 0) return [];

  const where = scope
    ? and(
        inArray(capabilityEvent.principalId, principalSet),
        eq(capabilityEvent.resourceType, scope.type),
        eq(capabilityEvent.resourceId, scope.id)
      )
    : inArray(capabilityEvent.principalId, principalSet);

  const rows = await db
    .select({
      resourceType: capabilityEvent.resourceType,
      resourceId: capabilityEvent.resourceId,
      ability: capabilityEvent.ability,
      action: capabilityEvent.action,
      createdAt: capabilityEvent.createdAt
    })
    .from(capabilityEvent)
    .where(where)
    .orderBy(asc(capabilityEvent.createdAt), asc(capabilityEvent.createdAtCounter));

  const latest = foldRevokeWins(rows, {
    key: (r) => (scope ? r.ability : `${r.resourceType} ${r.resourceId} ${r.ability}`),
    stamp: (r) => r.createdAt.getTime(),
    isRevoke: (r) => r.action === 'revoke'
  });

  const caps: Capability[] = [];
  for (const r of latest.values())
    if (r.action === 'grant')
      caps.push({
        ability: r.ability,
        resource: { type: r.resourceType as ResourceType, id: r.resourceId }
      });
  return caps;
}
