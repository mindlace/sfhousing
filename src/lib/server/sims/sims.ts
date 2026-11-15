import { and, eq, sql, type SQL } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import type { Database } from '$lib/server/db';
import { simIndex, simInvite } from '$lib/server/db/schema';
import { isValidId } from '$lib/server/ids/factory';
import { buildInsertSimIndexIfFreeSql, removeMembership, prepareLeave } from './sim-index';
import { buildFirstManagerGrantSql } from './sim-roles';
import { onSimRosterChanged } from './roster-hook';
import { loggable } from '$lib/server/sim-object/object-rules';

/**
 * Register a sim under a browser-minted id (R51). Throws Error('invalid sim id') unless
 * isValidId. created false: the id has a past (an index row, a takedown mark, a stored commit
 * or a ledger event), and nothing changed.
 *
 * One D1 batch (one transaction) of two statements: the conditional insert of the index row,
 * then the manager grant gated on `changes() = 1`, that is on THIS call's insert having written
 * the row. So the index row and its first manager grant become visible together, and knowing an
 * id never makes anyone its manager. A batch that throws wrote nothing.
 *
 * No roster hook: a sim just registered cannot have an open socket (the stream route answers
 * 404 until its index row exists), so the call would only wake an object for nothing. `env` is
 * not read here; callers pass the request's.
 */
export async function createSim(args: {
  db: Database;
  env: unknown;
  simId: string;
  title: string;
  managerId: string;
}): Promise<{ simId: string; created: boolean }> {
  const { db, simId } = args;
  if (!isValidId(simId)) throw new Error('invalid sim id');
  // Drizzle's batch does not take raw `sql` statements, so the two go to D1's own batch.
  const client = (db as Database & { $client?: D1Database }).$client;
  if (!client) throw new Error('D1 client unavailable');
  const prepare = (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    return client.prepare(text).bind(...params);
  };
  const [inserted] = await client.batch<{ sim_id: string }>([
    prepare(buildInsertSimIndexIfFreeSql({ simId, title: args.title })),
    // Gated on the statement before it, never on "no ledger event yet": an orphan index row
    // must not be claimable.
    prepare(buildFirstManagerGrantSql(simId, args.managerId, sql`(select changes()) = 1`))
  ]);
  return { simId, created: inserted.results.length === 1 };
}

const dialect = new SQLiteAsyncDialect();

/**
 * Drop the sim's index row and its pending invites in one batch. Ledger rows stay. Nothing a
 * member does reaches this: a sim whose last member goes is kept (removeSimMember). It is left
 * for an operator's takedown.
 */
export async function deleteSim(db: Database, simId: string): Promise<void> {
  await db.batch([
    db.delete(simIndex).where(eq(simIndex.simId, simId)),
    db.delete(simInvite).where(and(eq(simInvite.simId, simId), eq(simInvite.status, 'pending')))
  ]);
}

/**
 * THE single member-removal door. Removes the membership and enforces the sim-manager
 * invariant (auto-promoting a successor if the removal orphaned the sim). It never deletes a
 * sim: when no members remain (`{ empty: true }`) the sim is kept with its log and its index
 * row, so its links still open read-only and nobody can write it; its pending invitations end
 * here, in one statement. The caller authorizes (e.g. requireSimRole(manager) when removing
 * someone else).
 *
 * `actorUserId` opts into the co-manager protection: pass the acting principal's id on
 * administrative removal-of-another so removing a DIFFERENT manager is refused. Omit it
 * for self-removal and account deletion, which may remove a manager.
 *
 * After the change is written it awaits the roster hook, which never rejects, unless `notify`
 * is false: account deletion tells every sim it left in one fan-out instead.
 */
export async function removeSimMember(args: {
  db: Database;
  env: unknown;
  simId: string;
  userId: string;
  actorUserId?: string;
  notify?: boolean;
}): Promise<{ empty: boolean }> {
  const { empty } = await removeMembership(args.db, args.simId, args.userId, {
    actorUserId: args.actorUserId
  });
  if (empty) {
    // The revoke is committed: a failure here is logged, never reported as a failed removal,
    // and the hook below still runs.
    try {
      await args.db
        .delete(simInvite)
        .where(and(eq(simInvite.simId, args.simId), eq(simInvite.status, 'pending')));
    } catch (e) {
      console.error('[remove-member] pending invites not ended', args.simId, loggable(e));
    }
  }
  // Every removal, the last member's included: their open socket must lose write too.
  if (args.notify !== false) await onSimRosterChanged(args.env, args.simId);
  return { empty };
}

/**
 * Leave a sim = remove yourself, with the leave-specific guard (type-the-name when a
 * manager gives up control while other managers remain) and the chosen-successor courtesy.
 * Orphan-handling, and ending an emptied sim's pending invitations, come from removeSimMember.
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
