import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { account } from '$lib/server/db/schema';

/** Better-Auth `providerId`s for the social/OAuth sign-in methods configured in
 *  `auth.ts`. Email-link sign-ins use `'credential'`, not these. */
export const OAUTH_PROVIDER_IDS = ['google'] as const;

/** True if the live user row `liveUserId` (i.e. `locals.session.userId`) has a
 *  linked OAuth/social account. Such users already have a fast, secure sign-in
 *  method, so they don't get nudged to add a passkey. */
export async function userHasOAuthAccount(db: Database, liveUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, liveUserId), inArray(account.providerId, [...OAUTH_PROVIDER_IDS]))
    )
    .limit(1);
  return !!row;
}
