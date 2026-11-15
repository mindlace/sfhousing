import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '$lib/server/db';
import { principal, user, userIdentity } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';
import { loggable } from '$lib/server/sim-object/object-rules';
import { rosterChangedAll } from '$lib/server/sims/roster-hook';
import { foldSimsForUser } from '$lib/server/sims/sim-roles';
import { skeleton } from './confusable-skeleton';
import { generateUniqueHandle } from './handle';
import { recordUserVersion } from './history';
import { survivorId } from './user';

export type NewVersionColumns = {
  userIdentity: string;
  handle: string;
  handleSkeleton: string;
  /** Better-Auth field name — spread onto the auth user model by the create.before hook. */
  isAnonymous: boolean;
};

/** Create a fresh stable identity row; return columns to stamp on its live `user` row.
 *  No history append here — create.after (Better-Auth hook) appends once the live row exists. */
export async function createIdentityForNewVersion(args: {
  db: Database;
  pseudonymous?: boolean;
  displayName?: string | null;
}): Promise<NewVersionColumns> {
  const id = newId();
  await args.db.insert(principal).values({ id, kind: 'identity' });
  await args.db.insert(userIdentity).values({ id, createdAt: new Date() });
  const handle = await generateUniqueHandle({
    db: args.db,
    simTitle: args.displayName ?? undefined
  });
  return {
    userIdentity: id,
    handle,
    handleSkeleton: skeleton(handle),
    isAnonymous: args.pseudonymous === true
  };
}

/** Reseed the live row's handle (+ name) from the sim title — pseudonymous onboarding. */
export async function reseedHandleFromSim(args: {
  db: Database;
  identityId: string;
  simTitle: string;
  rng?: () => string;
}): Promise<string> {
  const handle = await generateUniqueHandle({
    db: args.db,
    simTitle: args.simTitle,
    rng: args.rng
  });
  await args.db
    .update(user)
    .set({ handle, name: handle, handleSkeleton: skeleton(handle), updatedAt: new Date() })
    .where(eq(user.userIdentity, args.identityId));
  const [row] = await args.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.userIdentity, args.identityId));
  await recordUserVersion({
    db: args.db,
    identityId: args.identityId,
    handle,
    name: handle,
    email: row?.email ?? ''
  });
  return handle;
}

/** Normalize Better-Auth's onLinkAccount args (wrapped { user, session }) to ids. */
export function normalizeLinkArgs(args: {
  anonymousUser: { user: { id: string } };
  newUser: { user: { id: string } };
}): { pseudonymousUserId: string; newUserId: string } {
  return { pseudonymousUserId: args.anonymousUser.user.id, newUserId: args.newUser.user.id };
}

/** Upgrade: pseudonymous identity SURVIVES; the freshly-created Google live row becomes its live row.
 *  The pseudonymous live row is hard-deleted (its handle freed first) and orphan identity G removed. */
async function applyUpgrade(db: Database, pseudoUserId: string, newUserId: string): Promise<void> {
  const [pseudo] = await db.select().from(user).where(eq(user.id, pseudoUserId));
  const [fresh] = await db.select().from(user).where(eq(user.id, newUserId));
  if (!pseudo || !fresh) return;
  const survivor = pseudo.userIdentity; // A
  const orphanIdentity = fresh.userIdentity; // G
  const pseudoHandle = pseudo.handle;
  // Atomic + ordered (a batch preserves statement order): (1) delete the pseudonymous live row
  // FIRST so its handle is free, then (2) repoint the Google row onto identity A taking that
  // handle — order avoids a UNIQUE(handle) collision — then (3) drop the now-unreferenced orphan
  // identity. Batching closes the partial-failure window the sequential form left open.
  const ops: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    db.delete(user).where(eq(user.id, pseudoUserId)),
    db
      .update(user)
      .set({
        userIdentity: survivor,
        handle: pseudoHandle,
        handleSkeleton: skeleton(pseudoHandle),
        isAnonymous: false,
        updatedAt: new Date()
      })
      .where(eq(user.id, newUserId))
  ];
  if (orphanIdentity && orphanIdentity !== survivor) {
    // FK: user_identity (child) must be deleted before principal (parent).
    ops.push(db.delete(userIdentity).where(eq(userIdentity.id, orphanIdentity)));
    ops.push(db.delete(principal).where(eq(principal.id, orphanIdentity)));
  }
  await db.batch(ops);
  await recordUserVersion({
    db,
    identityId: survivor,
    handle: pseudoHandle,
    name: fresh.name,
    email: fresh.email
  });
}

/** Fuse: the Google account belongs to a pre-existing identity whose LIVE survivor S wins.
 *  Pseudonymous identity A points DIRECTLY at S (depth-1 star), A's live row is snapshotted then
 *  hard-deleted, and any identity already pointing at A is collapsed onto S.
 *  Returns the ids of the sims A held a role on, read before the fuse writes (empty when
 *  `readSims` is false, when nothing fused, or when the read failed: it never blocks the fuse). */
async function applyFuse(
  db: Database,
  pseudoUserId: string,
  newUserId: string,
  readSims: boolean
): Promise<string[]> {
  const [pseudo] = await db.select().from(user).where(eq(user.id, pseudoUserId));
  const [fresh] = await db.select().from(user).where(eq(user.id, newUserId));
  if (!pseudo || !fresh) return [];
  const pseudoIdentity = pseudo.userIdentity; // A
  const survivor = await survivorId(db, fresh.userIdentity); // S (fresh's identity may itself be fused)
  if (!survivor || pseudoIdentity === survivor) return [];
  const now = new Date();
  // Read A's sims now: after the batch below A's own row is gone. A failed read is logged
  // (safe text only) and the fuse proceeds; nobody is told.
  let simIds: string[] = [];
  if (readSims) {
    try {
      simIds = (await foldSimsForUser(db, pseudoIdentity)).map((s) => s.simId);
    } catch (e) {
      console.error('[fuse] sims read failed', loggable(e));
    }
  }
  // Snapshot A's live row under A BEFORE deleting it (preserve pre-fusion attribution).
  await recordUserVersion({
    db,
    identityId: pseudoIdentity,
    handle: pseudo.handle,
    name: pseudo.name,
    email: pseudo.email
  });
  await db.batch([
    db
      .update(userIdentity)
      .set({ supersededById: survivor, supersededAt: now })
      .where(eq(userIdentity.id, pseudoIdentity)),
    db
      .update(userIdentity)
      .set({ supersededById: survivor, supersededAt: now })
      .where(eq(userIdentity.supersededById, pseudoIdentity)),
    db.delete(user).where(eq(user.id, pseudoUserId))
  ]);
  return simIds;
}

export async function handleAccountLink(args: {
  db: Database;
  isUpgrade: boolean;
  pseudonymousUserId: string;
  newUserId: string;
  /** R49: after a fuse, the absorbed identity's sims are told to re-read roles, handed to
   *  `defer` (the request's waitUntil) so a sign-in never waits on it. Absent where only the
   *  graph is under test: then nobody is told. */
  roster?: { env: unknown; defer: (work: Promise<void>) => void };
}): Promise<void> {
  if (args.isUpgrade) {
    await applyUpgrade(args.db, args.pseudonymousUserId, args.newUserId);
    return;
  }
  const simIds = await applyFuse(
    args.db,
    args.pseudonymousUserId,
    args.newUserId,
    args.roster !== undefined
  );
  if (args.roster && simIds.length > 0) {
    // rosterChangedAll never rejects; the guard keeps a throwing defer from failing the sign-in.
    const work = rosterChangedAll(args.roster.env, simIds);
    try {
      args.roster.defer(work);
    } catch (e) {
      console.error('[fuse] defer failed', loggable(e));
    }
  }
}
