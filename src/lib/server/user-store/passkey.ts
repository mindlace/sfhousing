import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { passkey } from '$lib/server/db/schema';

/** True if the live user row `liveUserId` (i.e. `locals.session.userId`) has ≥1 passkey. */
export async function userHasPasskey(db: Database, liveUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.userId, liveUserId))
    .limit(1);
  return !!row;
}
