import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { simIndex, user, type SimMemberRole } from '$lib/server/db/schema';
import { getUsers, survivorId } from '$lib/server/user-store/user';
import {
  addSimRole,
  foldManagedSimCount,
  foldSimMembers,
  foldSimRole,
  foldSimsForUser,
  revokeSimRoles,
  setSimRole,
  type SimMemberFold
} from './sim-roles';

/**
 * Record a new sim: its index row and the manager's membership (a manager role-grant
 * event on the capability ledger). The index row is inserted FIRST so a concurrent fold
 * read (which is index-gated) sees the sim, then the manager grant is appended.
 */
export async function createSimRecord(args: {
  db: Database;
  simId: string;
  title: string;
  managerId: string;
}): Promise<void> {
  const now = new Date();
  await args.db.insert(simIndex).values({
    simId: args.simId,
    title: args.title,
    createdAt: now,
    updatedAt: now
  });
  await addSimRole(args.db, args.simId, args.managerId, 'manager', args.managerId);
}

/**
 * Idempotently (re)seed a sim's control-plane projection. Unlike createSimRecord
 * — which assumes a freshly-provisioned sim and inserts unconditionally — this tolerates
 * an existing index row and an already-held manager grant, so calling it again for the
 * same sim changes nothing and restores whichever of the two is missing.
 */
export async function ensureSimRecord(args: {
  db: Database;
  simId: string;
  title: string;
  managerId: string;
}): Promise<void> {
  const now = new Date();
  await args.db
    .insert(simIndex)
    .values({
      simId: args.simId,
      title: args.title,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing();
  // addSimRole is a no-op when the role bundle is already held, so this self-heals.
  await addSimRole(args.db, args.simId, args.managerId, 'manager', args.managerId);
}

/** The sim's title from its index row. Null for a sim with no index row. */
export async function getSimTitle(args: { db: Database; simId: string }): Promise<string | null> {
  const rows = await args.db
    .select({ title: simIndex.title })
    .from(simIndex)
    .where(eq(simIndex.simId, args.simId))
    .limit(1);
  return rows[0]?.title ?? null;
}

/** Set a sim's title in its index row. */
export async function updateSimIndexTitle(args: {
  db: Database;
  simId: string;
  title: string;
}): Promise<void> {
  await args.db
    .update(simIndex)
    .set({ title: args.title, updatedAt: new Date() })
    .where(eq(simIndex.simId, args.simId));
}

/**
 * How many sims this identity MANAGES — the per-manager sim cap source of truth.
 * Management is multivariate: a sim counts iff the user holds a `manager`
 * membership on it (so a co-managed sim counts for every manager).
 */
export async function countSimsManagedBy(args: { db: Database; userId: string }): Promise<number> {
  return foldManagedSimCount(args.db, args.userId);
}

export type SimListItem = {
  simId: string;
  title: string;
  role: SimMemberRole;
};

/** Sims the user belongs to, joined to the index for the title. */
export async function listSimsForUser(args: {
  db: Database;
  userId: string;
}): Promise<SimListItem[]> {
  return foldSimsForUser(args.db, args.userId);
}

// manager is the HIGHEST role (lowest sort number); editor > viewer.
const ROLE_SORT: Record<SimMemberRole, number> = { manager: 0, editor: 1, viewer: 2 };

/** The user's role on a sim, or null if not a member (survivor+fused union via the fold). */
export async function getRole(args: {
  db: Database;
  simId: string;
  userId: string;
}): Promise<SimMemberRole | null> {
  return foldSimRole(args.db, args.simId, args.userId);
}

export type ControlPlaneMember = {
  userId: string;
  email: string;
  name: string;
  handle: string;
  image: string | null;
  role: SimMemberRole;
};

/**
 * A sim's members with display fields resolved through the user-store seam,
 * sorted manager→editor→viewer then by name.
 */
export async function listMembers(args: {
  db: Database;
  simId: string;
}): Promise<ControlPlaneMember[]> {
  const memberRows = await foldSimMembers(args.db, args.simId);
  const ids = memberRows.map((r) => r.userId);

  const users = await getUsers(args.db, ids);

  const result: ControlPlaneMember[] = [];
  for (const { userId, role } of memberRows) {
    const u = users.get(userId);
    if (!u) continue; // membership row without a live user — skip rather than throw
    result.push({
      userId,
      role,
      email: u.email,
      name: u.name,
      handle: u.handle,
      image: u.image ?? null
    });
  }

  return result.sort((a, b) =>
    a.role !== b.role ? ROLE_SORT[a.role] - ROLE_SORT[b.role] : a.name.localeCompare(b.name)
  );
}

/** Add a member by email. Pure data op — caller authorizes via requireSimRole(manager). */
export async function addMember(args: {
  db: Database;
  simId: string;
  email: string;
  role: SimMemberRole;
}): Promise<{ userId: string }> {
  const found = await args.db
    .select({ id: user.userIdentity })
    .from(user)
    .where(eq(user.email, args.email));
  if (found.length === 0) throw new Error('user not found');
  const userId = found[0].id;

  const { added } = await addSimRole(args.db, args.simId, userId, args.role, null);
  if (!added) throw new Error('already a member');
  return { userId };
}

/** Add a member by already-resolved identity id. Idempotent. */
export async function addMemberById(args: {
  db: Database;
  simId: string;
  userId: string;
  role: SimMemberRole;
}): Promise<{ added: boolean }> {
  return addSimRole(args.db, args.simId, args.userId, args.role, null);
}

/** Pick a successor from non-manager members: highest ROLE_SORT, tie-break joinedAt asc then userId asc. */
function pickSuccessor(rows: SimMemberFold[]): string {
  return [...rows].sort((a, b) => {
    if (ROLE_SORT[a.role] !== ROLE_SORT[b.role]) return ROLE_SORT[a.role] - ROLE_SORT[b.role];
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.userId.localeCompare(b.userId);
  })[0].userId;
}

/**
 * Enforce "a sim always has a manager (or is empty)" on the CURRENT membership set.
 * Does NOT remove any membership — it only repairs manager-lessness.
 *  - some manager present           → { empty: false }
 *  - no manager but members remain  → promote an auto-picked successor (retrying if the
 *    pick vanished mid-promote)     → { empty: false }
 *  - no members at all              → { empty: true }
 */
export async function reconcileSimManagement(
  db: Database,
  simId: string
): Promise<{ empty: boolean }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const members = await foldSimMembers(db, simId);
    if (!members.length) return { empty: true };
    if (members.some((m) => m.role === 'manager')) return { empty: false };

    const successor = pickSuccessor(members);
    await setSimRole(db, simId, successor, 'manager', null);

    const managers = (await foldSimMembers(db, simId)).filter((m) => m.role === 'manager');
    if (managers.length >= 1) return { empty: false };
    // A concurrent revoke stripped the new manager grant before the re-read — retry.
    // (setSimRole always appends the grant, so the only way no manager shows is a race.)
  }
  throw new Error('could not establish a sim manager; please retry');
}

/**
 * Revoke one membership (across the member's fused identities), then reconcile
 * management. `removeSimMember` in sims.ts calls it and deletes the sim when { empty }.
 * Returns `members`, the roster fold from before the revoke.
 *
 * Co-manager protection: when `actorUserId` is supplied AND it is removing a
 * DIFFERENT principal who currently holds `manager`, the removal is refused — a manager
 * must give up control themselves (the leave path's type-the-name guard), not be
 * ejected by a peer manager. The guard is opt-in: only administrative removal-of-another
 * (the members DELETE route) passes `actorUserId`. Self-removal, account deletion, and
 * orphan teardown omit it and may remove a manager.
 */
export async function removeMembership(
  db: Database,
  simId: string,
  userId: string,
  opts?: { actorUserId?: string }
): Promise<{ empty: boolean; members: SimMemberFold[] }> {
  // The fold lists survivors only, and the revoke reaches the whole principal union: resolve
  // both ids to their survivors first, so a fused id names the same member to the guard, the
  // self-removal rule and the revoke.
  const target = (await survivorId(db, userId)) ?? userId;
  const actor = opts?.actorUserId
    ? ((await survivorId(db, opts.actorUserId)) ?? opts.actorUserId)
    : undefined;
  const members = await foldSimMembers(db, simId);
  if (actor && actor !== target) {
    const member = members.find((m) => m.userId === target);
    if (member?.role === 'manager')
      throw new Error('cannot remove another manager; they must leave the sim themselves');
  }
  await revokeSimRoles(db, simId, target);
  const { empty } = await reconcileSimManagement(db, simId);
  return { empty, members };
}

/**
 * Leave-specific pre-step (pure D1): validate the leaver and honor their successor pick.
 *  - not a member                                    → throw 'not a member'
 *  - manager leaving while OTHER managers exist, with
 *    a mismatched confirmTitle                       → throw 'title did not match'
 *  - SOLE manager with a successorUserId that is a
 *    current other member                            → promote that successor (courtesy)
 *  - otherwise                                        → no-op (removeMembership's reconcile auto-picks)
 */
export async function prepareLeave(
  db: Database,
  args: {
    simId: string;
    userId: string;
    simTitle: string;
    confirmTitle?: string;
    successorUserId?: string;
  }
): Promise<void> {
  const members = await foldSimMembers(db, args.simId);

  const me = members.find((m) => m.userId === args.userId);
  if (!me) throw new Error('not a member');

  const managers = members.filter((m) => m.role === 'manager');

  if (me.role === 'manager' && managers.length > 1) {
    if (args.confirmTitle !== args.simTitle) throw new Error('title did not match');
    return;
  }

  if (me.role === 'manager' && managers.length === 1) {
    const others = members.filter((m) => m.userId !== args.userId);
    if (args.successorUserId && others.some((o) => o.userId === args.successorUserId)) {
      await setSimRole(db, args.simId, args.successorUserId, 'manager', null);
    }
  }
}
