import { eq, inArray, or } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { userIdentity, userVersion } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';

/** Append one immutable history snapshot. The ONLY writer of `user_version`. */
export async function recordUserVersion(args: {
  db: Database;
  identityId: string;
  handle: string;
  name: string;
  email: string;
}): Promise<void> {
  await args.db.insert(userVersion).values({
    id: newId(),
    userIdentity: args.identityId,
    handle: args.handle,
    name: args.name,
    email: args.email,
    capturedAt: new Date()
  });
}

/**
 * The full anti-abuse trail for a survivor identity: its own history rows plus those of
 * every identity fused DIRECTLY into it (depth-1 star), chronological. Two indexed queries,
 * no recursion. Pass the SURVIVOR id (resolve via survivorId first if you hold a fused id).
 */
export async function getUserHistory(db: Database, survivorId: string) {
  const ids = await db
    .select({ id: userIdentity.id })
    .from(userIdentity)
    .where(or(eq(userIdentity.id, survivorId), eq(userIdentity.supersededById, survivorId)));
  const rows = await db
    .select()
    .from(userVersion)
    .where(
      inArray(
        userVersion.userIdentity,
        ids.map((r) => r.id)
      )
    );
  return rows.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}
