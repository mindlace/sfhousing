import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { user, handleTombstone } from '$lib/server/db/schema';
import { survivorId } from './user';
import { recordUserVersion } from './history';
import { validateHandle } from './handle-normalize';
import { skeleton } from './confusable-skeleton';

const HANDLE_REASON_MESSAGES: Record<string, string> = {
  length: 'Handles are 3–30 characters.',
  charset: 'Handles can only use letters, numbers, and single hyphens.',
  hyphen: 'Handles cannot start or end with a hyphen, or contain consecutive hyphens.',
  'mixed-script': 'Handles must use a single script — please do not mix alphabets.',
  'unsupported-script': 'That script is not supported for handles yet.',
  reserved: 'That handle is reserved. Please choose another.'
};

function handleReasonMessage(reason: string): string {
  return HANDLE_REASON_MESSAGES[reason] ?? 'That handle is not valid.';
}

/** A skeleton is available iff no live user holds it AND no non-expired tombstone holds it. */
export async function isHandleAvailable(db: Database, sk: string, now: Date): Promise<boolean> {
  const live = await db.select({ id: user.id }).from(user).where(eq(user.handleSkeleton, sk));
  if (live.length > 0) return false;
  const tomb = await db
    .select({ handle: handleTombstone.handle })
    .from(handleTombstone)
    .where(and(eq(handleTombstone.skeleton, sk), gt(handleTombstone.expiresAt, now)));
  return tomb.length === 0;
}

export const HANDLE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type UpdateProfileInput = { handle?: string; name?: string };
export type UpdateProfileResult =
  | {
      ok: true;
      handleChanged: boolean;
      oldHandleFreesAt: Date | null;
      /** The values as STORED — handle case-folded by validateHandle, name trimmed + NFC.
       *  Returned so the client can local-apply the write without re-reading page data. */
      handle: string;
      name: string;
    }
  | { ok: false; reason: string };

/**
 * Change a user's handle and/or display name. Tombstones the old handle (1-year TTL),
 * enforces a 7-day per-identity handle-change cooldown, and records a history snapshot.
 */
export async function updateProfile(
  db: Database,
  identityId: string,
  input: UpdateProfileInput,
  now: Date
): Promise<UpdateProfileResult> {
  const sid = await survivorId(db, identityId);
  if (!sid) return { ok: false, reason: 'Account not found.' };
  const [live] = await db.select().from(user).where(eq(user.userIdentity, sid));
  if (!live) return { ok: false, reason: 'Account not found.' };

  let nextName = live.name;
  if (input.name !== undefined) {
    const trimmed = input.name.trim().normalize('NFC');
    if (trimmed.length > 60) {
      return { ok: false, reason: 'Display name must be 60 characters or fewer.' };
    }
    nextName = trimmed;
  }

  let handleChanged = false;
  let oldHandleFreesAt: Date | null = null;
  let nextHandle = live.handle;
  let nextSkeleton: string | null = null;
  if (input.handle !== undefined) {
    const v = validateHandle(input.handle);
    if (!v.ok) return { ok: false, reason: handleReasonMessage(v.reason) };
    if (v.handle !== live.handle) {
      if (!(await isHandleAvailable(db, v.skeleton, now))) {
        return { ok: false, reason: 'That handle is already taken.' };
      }
      const recent = await db
        .select({ releasedAt: handleTombstone.releasedAt })
        .from(handleTombstone)
        .where(
          and(
            eq(handleTombstone.releasedBy, sid),
            gt(handleTombstone.releasedAt, new Date(now.getTime() - HANDLE_COOLDOWN_MS))
          )
        );
      if (recent.length > 0) {
        return { ok: false, reason: 'You can only change your handle once a week.' };
      }
      handleChanged = true;
      nextHandle = v.handle;
      nextSkeleton = v.skeleton;
      oldHandleFreesAt = new Date(now.getTime() + TOMBSTONE_TTL_MS);
    }
  }

  if (handleChanged) {
    await db.batch([
      db.insert(handleTombstone).values({
        handle: live.handle,
        skeleton: skeleton(live.handle),
        releasedBy: sid,
        releasedAt: now,
        expiresAt: oldHandleFreesAt as Date
      }),
      db
        .update(user)
        .set({ handle: nextHandle, handleSkeleton: nextSkeleton, name: nextName, updatedAt: now })
        .where(eq(user.id, live.id))
    ]);
  } else {
    await db.update(user).set({ name: nextName, updatedAt: now }).where(eq(user.id, live.id));
  }

  await recordUserVersion({
    db,
    identityId: sid,
    handle: nextHandle,
    name: nextName,
    email: live.email
  });

  return { ok: true, handleChanged, oldHandleFreesAt, handle: nextHandle, name: nextName ?? '' };
}
