import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { account, passkey, user } from '$lib/server/db/schema';
import { survivorId } from '$lib/server/user-store/user';

/**
 * Provider ids that make an account durable — i.e. the holder can get back in
 * after the session ends. `credential` is Better-Auth's password row; `google`
 * is our only social provider. Listed EXPLICITLY rather than counting any
 * account row, so a future provider must be considered rather than silently
 * conferring durability.
 */
export const STRONG_PROVIDERS = ['credential', 'google'] as const;

/**
 * True if the identity has an auth factor that survives the session: a password,
 * an OAuth account, or a passkey.
 *
 * NOTE: a password makes an account durable WITHOUT ending pseudonymity — that is
 * the point of the password feature. Durable ≠ identified. The `anonymous` plugin
 * creates no `account` row, so a pseudonymous account with no added factor
 * correctly returns false.
 */
export async function hasStrongAuthFactor(db: Database, identityId: string): Promise<boolean> {
  const sid = await survivorId(db, identityId);
  if (!sid) return false;
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.userIdentity, sid));
  if (!u) return false;
  const accounts = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, u.id), inArray(account.providerId, [...STRONG_PROVIDERS])));
  if (accounts.length > 0) return true;
  const passkeys = await db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.userId, u.id));
  return passkeys.length > 0;
}
