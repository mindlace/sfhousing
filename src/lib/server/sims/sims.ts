import { and, eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { simIndex, simInvite } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';
import { createSimRecord, removeMembership, prepareLeave } from './sim-index';
import { onSimRosterChanged } from './roster-hook';

/**
 * Create a sim: mint its id, record the index row, then the manager's grant. No roster hook:
 * a sim just registered cannot have an open socket (the stream route answers 404 until its
 * index row exists), so the call would only wake an object for nothing. `env` is not read
 * here yet; callers already pass the request's.
 */
export async function createSim(args: {
  db: Database;
  env: unknown;
  title: string;
  managerId: string;
}): Promise<{ simId: string }> {
  const simId = newId();
  await createSimRecord({ db: args.db, simId, title: args.title, managerId: args.managerId });
  return { simId };
}

/** Drop the sim's index row and its pending invites in one batch. Ledger rows stay. */
export async function deleteSim(db: Database, simId: string): Promise<void> {
  await db.batch([
    db.delete(simIndex).where(eq(simIndex.simId, simId)),
    db.delete(simInvite).where(and(eq(simInvite.simId, simId), eq(simInvite.status, 'pending')))
  ]);
}

/**
 * THE single member-removal door. Removes the membership, enforces the sim-manager
 * invariant (auto-promoting a successor if the removal orphaned the sim), and deletes
 * the sim entirely when no members remain. The caller authorizes (e.g. requireSimRole(manager)
 * when removing someone else).
 *
 * `actorUserId` opts into the co-manager protection: pass the acting principal's id on
 * administrative removal-of-another so removing a DIFFERENT manager is refused. Omit it
 * for self-removal / account deletion / orphan teardown, which may remove a manager.
 *
 * After the removal is written (and an emptied sim deleted) it awaits the roster hook, which
 * never rejects, unless `notify` is false: account deletion tells every sim it left in one
 * fan-out instead.
 */
export async function removeSimMember(args: {
  db: Database;
  env: unknown;
  simId: string;
  userId: string;
  actorUserId?: string;
  notify?: boolean;
}): Promise<{ deleted: boolean }> {
  const { empty } = await removeMembership(args.db, args.simId, args.userId, {
    actorUserId: args.actorUserId
  });
  if (empty) await deleteSim(args.db, args.simId);
  // Every removal, the last member's included: their open socket must lose write too.
  if (args.notify !== false) await onSimRosterChanged(args.env, args.simId);
  return { deleted: empty };
}

/**
 * Leave a sim = remove yourself, with the leave-specific guard (type-the-name when a
 * manager gives up control while other managers remain) and the chosen-successor courtesy.
 * Orphan-handling and delete-if-empty come from removeSimMember.
 */
export async function leaveSim(args: {
  db: Database;
  env: unknown;
  simId: string;
  userId: string;
  simTitle: string;
  confirmTitle?: string;
  successorUserId?: string;
}): Promise<void> {
  await prepareLeave(args.db, {
    simId: args.simId,
    userId: args.userId,
    simTitle: args.simTitle,
    confirmTitle: args.confirmTitle,
    successorUserId: args.successorUserId
  });
  await removeSimMember({ db: args.db, env: args.env, simId: args.simId, userId: args.userId });
}
