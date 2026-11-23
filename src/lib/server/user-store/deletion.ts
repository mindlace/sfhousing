import { eq, inArray } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import {
  user,
  userIdentity,
  userVersion,
  session,
  account,
  passkey,
  handleTombstone
} from '$lib/server/db/schema';
import { skeleton } from './confusable-skeleton';
import { sha256Hex } from '$lib/sharing/hash';
import { survivorId } from './user';
import { recordUserVersion } from './history';

const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const HEX64 = /^[a-f0-9]{64}$/;

export function deletedHandle(identityId: string): string {
  return `deleted-${identityId}`;
}

export function deletedEmail(identityId: string): string {
  return `deleted-${identityId}@example.com`;
}

/** Reserve the released handle so it isn't instantly grabbable (1-year cooldown). */
export async function releaseHandle(
  db: Database,
  identityId: string,
  oldHandle: string,
  now: Date
): Promise<void> {
  await db
    .insert(handleTombstone)
    .values({
      handle: oldHandle,
      skeleton: skeleton(oldHandle),
      releasedBy: identityId,
      releasedAt: now,
      expiresAt: new Date(now.getTime() + TOMBSTONE_TTL_MS)
    })
    .onConflictDoNothing();
}

/** Overwrite the live user row with anonymized placeholders. Unique by identity id. */
export async function scrubLiveUser(
  db: Database,
  identityId: string,
  liveUserId: string,
  now: Date
): Promise<void> {
  const h = deletedHandle(identityId);
  await db
    .update(user)
    .set({
      handle: h,
      handleSkeleton: skeleton(h),
      email: deletedEmail(identityId),
      name: 'Deleted User',
      image: null,
      updatedAt: now
    })
    .where(eq(user.id, liveUserId));
}

/**
 * Right-to-erasure on the otherwise-immutable trail: replace plaintext email + name with
 * SHA-256 (normalized) across the identity union, KEEPING handle for the sockpuppet trail.
 * Skips the deleted-<id> placeholder rows and rows already hashed → idempotent.
 */
export async function hashPriorVersions(db: Database, identityIds: string[]): Promise<void> {
  const placeholderEmails = new Set(identityIds.map(deletedEmail));
  const rows = await db
    .select()
    .from(userVersion)
    .where(inArray(userVersion.userIdentity, identityIds));
  for (const r of rows) {
    if (placeholderEmails.has(r.email)) continue; // tombstone row — skip
    const emailHashed = HEX64.test(r.email);
    const nameHashed = HEX64.test(r.name);
    if (emailHashed && nameHashed) continue; // already erased (re-run)
    await db
      .update(userVersion)
      .set({
        email: emailHashed ? r.email : await sha256Hex(r.email.trim().toLowerCase()),
        name: nameHashed ? r.name : await sha256Hex(r.name.trim().toLowerCase())
      })
      .where(eq(userVersion.id, r.id));
  }
}

/** Delete the live user's credentials: its session, account and passkey rows. */
export async function purgeCredentialsAndSettings(db: Database, liveUserId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, liveUserId));
  await db.delete(account).where(eq(account.userId, liveUserId));
  await db.delete(passkey).where(eq(passkey.userId, liveUserId));
}

/** The tombstone fuse — set LAST. */
export async function markIdentityDeleted(
  db: Database,
  identityId: string,
  now: Date
): Promise<void> {
  await db.update(userIdentity).set({ deletedAt: now }).where(eq(userIdentity.id, identityId));
}

/**
 * Delete an account in one request: scrub + tombstone the identity and purge its PII and
 * credentials. Ordered + idempotent; gated on user_identity.deleted_at so a completed run
 * re-invoked is a no-op. Caller authorizes and handles sign-out. NOT atomic.
 *
 * Always answers `{ more: false }`: there is nothing left for a later request, including for
 * an unknown or already deleted identity, or one with no live row.
 */
export async function deleteAccount(args: {
  db: Database;
  identityId: string;
}): Promise<{ more: false }> {
  const { db } = args;
  const sid = (await survivorId(db, args.identityId)) ?? args.identityId;

  const [idRow] = await db.select().from(userIdentity).where(eq(userIdentity.id, sid));
  if (!idRow || idRow.deletedAt) return { more: false }; // unknown or already deleted → no-op
  const [live] = await db.select().from(user).where(eq(user.userIdentity, sid));
  if (!live) return { more: false };

  await closeAccountRows({ db, identityId: sid, live });
  return { more: false };
}

/** The account closure of deleteAccount: release the handle, scrub, history, credentials,
 *  tombstone. `live` is the live `user` row for `identityId`. */
export async function closeAccountRows(args: {
  db: Database;
  identityId: string;
  live: typeof user.$inferSelect;
}): Promise<void> {
  const { db, identityId: sid, live } = args;
  const now = new Date();

  // 1. Release the old handle, scrub the live row, record the tombstone version.
  await releaseHandle(db, sid, live.handle, now);
  await scrubLiveUser(db, sid, live.id, now);
  await recordUserVersion({
    db,
    identityId: sid,
    handle: deletedHandle(sid),
    name: 'Deleted User',
    email: deletedEmail(sid)
  });

  // 2. Erase PII across the full identity union (survivor + identities fused into it):
  //    hash prior versions for every id in the union.
  const fusedIn = await db
    .select({ id: userIdentity.id })
    .from(userIdentity)
    .where(eq(userIdentity.supersededById, sid));
  const idUnion = [sid, ...fusedIn.map((r) => r.id)];
  await hashPriorVersions(db, idUnion);

  // 3. Purge credentials (by live user id).
  await purgeCredentialsAndSettings(db, live.id);

  // 4. Tombstone fuse — LAST.
  await markIdentityDeleted(db, sid, now);
}
