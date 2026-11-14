import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { normalizeHandle } from '$lib/server/user-store/handle-normalize';

/** Resolve a handle to its account's real email. Returns null for unknown handles. */
export async function resolveHandleToEmail(db: Database, handle: string): Promise<string | null> {
  // Match the stored canonical handle (NFC + case-folded), NOT the skeleton — a
  // confusable look-alike must not resolve to someone else's account.
  const normalized = normalizeHandle(handle);
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.handle, normalized));
  return row?.email ?? null;
}
