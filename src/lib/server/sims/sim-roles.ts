import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { capabilityEvent, simIndex, type SimMemberRole } from '$lib/server/db/schema';
import { principalUnion, survivorId } from '$lib/server/user-store/user';
import { newId } from '$lib/server/ids/base58';
import { ROLE_BUNDLE } from '$lib/server/authz';
import { insertCapabilityEvent } from '$lib/server/db/capability-events';
import { foldRevokeWins } from '$lib/server/event-log/fold';

const BUNDLE_BY_ROLE: Record<SimMemberRole, string> = {
  manager: ROLE_BUNDLE.manager,
  editor: ROLE_BUNDLE.editor,
  viewer: ROLE_BUNDLE.viewer
};
const ROLE_BY_BUNDLE: Record<string, SimMemberRole> = {
  [ROLE_BUNDLE.manager]: 'manager',
  [ROLE_BUNDLE.editor]: 'editor',
  [ROLE_BUNDLE.viewer]: 'viewer'
};
const ROLE_BUNDLES = [ROLE_BUNDLE.manager, ROLE_BUNDLE.editor, ROLE_BUNDLE.viewer];
const ROLE_RANK: Record<SimMemberRole, number> = { viewer: 0, editor: 1, manager: 2 };

const higher = (a: SimMemberRole, b: SimMemberRole): SimMemberRole =>
  ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;

type RoleRow = { ability: string; action: 'grant' | 'revoke'; createdAt: Date };

/**
 * Reduce ordered events to the latest action per ability. Last-write-wins by
 * `createdAt`; on an EQUAL `createdAt`, REVOKE wins (fail-safe / least-privilege).
 *
 * INVARIANT (guarded by sim-roles.spec.ts): no single writer CALL co-emits a
 * grant AND a revoke for the same (principal, resourceType, resourceId, ability) in
 * its one insert batch — setSimRole grants the target bundle and revokes only
 * OTHER held bundles; addSimRole grants only; revokeSimRoles revokes only.
 *
 * That per-call invariant does NOT extend across calls: two SEPARATE rapid calls
 * (e.g. addSimRole('viewer') then setSimRole('editor'), which revokes viewer)
 * can stamp a grant and a revoke of the same bundle in the SAME millisecond. The fold
 * queries order by `(created_at, created_at_counter)` — deterministic and
 * insertion-faithful within a node (stamped atomically in-SQL by insertCapabilityEvent).
 * The revoke-wins rule here remains load-bearing: it makes the fold fail-closed
 * (least-privilege) under a same-ms grant/revoke collision, and will handle cross-node
 * clock skew once federation lands.
 */
function latestActionByAbility(rows: RoleRow[]): Map<string, 'grant' | 'revoke'> {
  const latest = foldRevokeWins(rows, {
    key: (r) => r.ability,
    stamp: (r) => r.createdAt.getTime(),
    isRevoke: (r) => r.action === 'revoke'
  });
  const out = new Map<string, 'grant' | 'revoke'>();
  for (const [ability, r] of latest) out.set(ability, r.action);
  return out;
}

/** Reduce ordered (oldest→newest) role events into the effective role + the earliest grant
 *  time (the "joinedAt" signal). `joinedAt` is the earliest-ever grant across ANY bundle and
 *  intentionally survives a later revoke+regrant — it is the original join date, not the most
 *  recent one. Tie-break / invariant: see {@link latestActionByAbility}. */
function effectiveRole(rows: RoleRow[]): { role: SimMemberRole | null; joinedAt: number } {
  let firstGrant = Infinity;
  for (const r of rows)
    if (r.action === 'grant') firstGrant = Math.min(firstGrant, r.createdAt.getTime());
  let role: SimMemberRole | null = null;
  for (const [ability, action] of latestActionByAbility(rows))
    if (action === 'grant') {
      const r = ROLE_BY_BUNDLE[ability];
      role = role ? higher(role, r) : r;
    }
  return { role, joinedAt: firstGrant === Infinity ? 0 : firstGrant };
}

/** Effective role for one principal on one sim (survivor+fused union; index-gated). */
export async function foldSimRole(
  db: Database,
  simId: string,
  identityId: string
): Promise<SimMemberRole | null> {
  const ids = await principalUnion(db, identityId);
  const rows = await db
    .select({
      ability: capabilityEvent.ability,
      action: capabilityEvent.action,
      createdAt: capabilityEvent.createdAt
    })
    .from(capabilityEvent)
    .innerJoin(simIndex, eq(simIndex.simId, capabilityEvent.resourceId))
    .where(
      and(
        inArray(capabilityEvent.principalId, ids),
        eq(capabilityEvent.resourceType, 'sim'),
        eq(capabilityEvent.resourceId, simId),
        inArray(capabilityEvent.ability, ROLE_BUNDLES)
      )
    )
    .orderBy(asc(capabilityEvent.createdAt), asc(capabilityEvent.createdAtCounter));
  return effectiveRole(rows).role;
}

export type SimMemberFold = { userId: string; role: SimMemberRole; joinedAt: number };

/** All current members of a sim (fused principals collapsed onto survivors, highest role). */
export async function foldSimMembers(db: Database, simId: string): Promise<SimMemberFold[]> {
  const rows = await db
    .select({
      principalId: capabilityEvent.principalId,
      ability: capabilityEvent.ability,
      action: capabilityEvent.action,
      createdAt: capabilityEvent.createdAt
    })
    .from(capabilityEvent)
    .innerJoin(simIndex, eq(simIndex.simId, capabilityEvent.resourceId))
    .where(
      and(
        eq(capabilityEvent.resourceType, 'sim'),
        eq(capabilityEvent.resourceId, simId),
        inArray(capabilityEvent.ability, ROLE_BUNDLES)
      )
    )
    .orderBy(asc(capabilityEvent.createdAt), asc(capabilityEvent.createdAtCounter));

  // Group raw events per principal, reduce to effective role, then collapse fused→survivor.
  const byPrincipal = new Map<string, RoleRow[]>();
  for (const r of rows) {
    const list = byPrincipal.get(r.principalId) ?? [];
    list.push({ ability: r.ability, action: r.action, createdAt: r.createdAt });
    byPrincipal.set(r.principalId, list);
  }
  const merged = new Map<string, SimMemberFold>();
  for (const [principalId, list] of byPrincipal) {
    const { role, joinedAt } = effectiveRole(list);
    if (!role) continue;
    const survivor = (await survivorId(db, principalId)) ?? principalId;
    const cur = merged.get(survivor);
    if (!cur) merged.set(survivor, { userId: survivor, role, joinedAt });
    else
      merged.set(survivor, {
        userId: survivor,
        role: higher(cur.role, role),
        joinedAt: Math.min(cur.joinedAt, joinedAt)
      });
  }
  return [...merged.values()];
}

export type SimRoleListItem = { simId: string; title: string; role: SimMemberRole };

/** Sims the principal (survivor+fused) holds any role on, with highest role + title. */
export async function foldSimsForUser(
  db: Database,
  identityId: string
): Promise<SimRoleListItem[]> {
  const ids = await principalUnion(db, identityId);
  const rows = await db
    .select({
      simId: capabilityEvent.resourceId,
      title: simIndex.title,
      ability: capabilityEvent.ability,
      action: capabilityEvent.action,
      createdAt: capabilityEvent.createdAt
    })
    .from(capabilityEvent)
    .innerJoin(simIndex, eq(simIndex.simId, capabilityEvent.resourceId))
    .where(
      and(
        inArray(capabilityEvent.principalId, ids),
        eq(capabilityEvent.resourceType, 'sim'),
        inArray(capabilityEvent.ability, ROLE_BUNDLES)
      )
    )
    .orderBy(asc(capabilityEvent.createdAt), asc(capabilityEvent.createdAtCounter));

  const perSim = new Map<string, { title: string; rows: RoleRow[] }>();
  for (const r of rows) {
    const e = perSim.get(r.simId) ?? { title: r.title, rows: [] };
    e.rows.push({ ability: r.ability, action: r.action, createdAt: r.createdAt });
    perSim.set(r.simId, e);
  }
  const out: SimRoleListItem[] = [];
  for (const [simId, { title, rows: rs }] of perSim) {
    const { role } = effectiveRole(rs);
    if (role) out.push({ simId, title, role });
  }
  return out;
}

/** Count of existing sims the principal manages (the per-manager sim-cap source of truth). */
export async function foldManagedSimCount(db: Database, identityId: string): Promise<number> {
  return (await foldSimsForUser(db, identityId)).filter((q) => q.role === 'manager').length;
}

// ---- write helpers (operate on the EXACT principal id; no union, no index gate) ----
// Writes are index-BLIND by design: they append role events without checking sim_index.
// Reads (above) gate on the index, so a grant only surfaces once the sim exists. The
// caller (createSimRecord) inserts the index row alongside the manager grant. Do not add an
// index gate here — the read/write asymmetry is intentional.

async function heldBundles(db: Database, simId: string, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      ability: capabilityEvent.ability,
      action: capabilityEvent.action,
      createdAt: capabilityEvent.createdAt
    })
    .from(capabilityEvent)
    .where(
      and(
        eq(capabilityEvent.principalId, userId),
        eq(capabilityEvent.resourceType, 'sim'),
        eq(capabilityEvent.resourceId, simId),
        inArray(capabilityEvent.ability, ROLE_BUNDLES)
      )
    )
    .orderBy(asc(capabilityEvent.createdAt), asc(capabilityEvent.createdAtCounter));
  const held = new Set<string>();
  for (const [ability, action] of latestActionByAbility(rows))
    if (action === 'grant') held.add(ability);
  return held;
}

function roleEvent(
  simId: string,
  userId: string,
  ability: string,
  action: 'grant' | 'revoke',
  actorId: string | null
) {
  return {
    id: newId(),
    principalId: userId,
    resourceType: 'sim' as const,
    resourceId: simId,
    ability,
    action,
    caveats: null,
    parentId: null,
    actorId
  };
}

/** Set a principal's role to EXACTLY `role` on a sim (idempotent). Grants the target
 *  bundle if not held; revokes any other held role bundle. */
export async function setSimRole(
  db: Database,
  simId: string,
  userId: string,
  role: SimMemberRole,
  actorId: string | null = null
): Promise<void> {
  const target = BUNDLE_BY_ROLE[role];
  const held = await heldBundles(db, simId, userId);
  const events = [];
  if (!held.has(target)) events.push(roleEvent(simId, userId, target, 'grant', actorId));
  for (const b of held)
    if (b !== target) events.push(roleEvent(simId, userId, b, 'revoke', actorId));
  for (const e of events) await insertCapabilityEvent(db, e);
}

/** Grant `role` only if the principal currently holds NO role on the sim (idempotent add). */
export async function addSimRole(
  db: Database,
  simId: string,
  userId: string,
  role: SimMemberRole,
  actorId: string | null = null
): Promise<{ added: boolean }> {
  const held = await heldBundles(db, simId, userId);
  if (held.size > 0) return { added: false };
  await insertCapabilityEvent(db, roleEvent(simId, userId, BUNDLE_BY_ROLE[role], 'grant', actorId));
  return { added: true };
}

/** Revoke every role bundle the principal currently holds on the sim (membership removal). */
export async function revokeSimRoles(
  db: Database,
  simId: string,
  userId: string,
  actorId: string | null = null
): Promise<void> {
  const held = await heldBundles(db, simId, userId);
  const events = [...held].map((b) => roleEvent(simId, userId, b, 'revoke', actorId));
  for (const e of events) await insertCapabilityEvent(db, e);
}
