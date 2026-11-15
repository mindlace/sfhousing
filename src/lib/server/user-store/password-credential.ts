import { and, eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { account, passkey, user } from '$lib/server/db/schema';
import { survivorId } from '$lib/server/user-store/user';
import { STRONG_PROVIDERS } from '$lib/server/user-store/auth-factors';
import { mayReceivePasswordReset } from '$lib/server/auth/password-reset-gate';

/** Better-Auth's provider id for a password row. */
const CREDENTIAL = 'credential';

/**
 * The live `user` row behind an identity id, resolved through its survivor.
 *
 * Exported so a handler that both CHECKS and MUTATES can resolve the user once
 * and pass the same row to every step. The password route is destructive on
 * failure (a wrong row means either stranding an account or deleting someone
 * else's credential), so its guard and its delete must not re-resolve
 * independently and risk disagreeing about which row they mean.
 */
export async function liveUserFor(db: Database, identityId: string) {
  const sid = await survivorId(db, identityId);
  if (!sid) return null;
  const [u] = await db
    .select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.userIdentity, sid));
  return u ?? null;
}

export type LiveUser = Awaited<ReturnType<typeof liveUserFor>>;

/** Does this identity have a password set? */
export async function hasPassword(db: Database, identityId: string): Promise<boolean> {
  return hasPasswordForUser(db, await liveUserFor(db, identityId));
}

/** As `hasPassword`, against an already-resolved live user row. */
export async function hasPasswordForUser(db: Database, u: LiveUser): Promise<boolean> {
  if (!u) return false;
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, u.id), eq(account.providerId, CREDENTIAL)));
  return rows.length > 0;
}

/**
 * May the password be removed without stranding the user?
 *
 * False when the password is the ONLY way back in — no passkey, no OAuth account,
 * and no real verified email. Removing it there would silently convert a durable
 * account into one with no way back in (a pseudonymous account without a credential
 * cannot sign back in). The UI disables the control on this basis; this
 * function is the server-side enforcement behind it.
 *
 * Vacuously true when there is no password at all — there is nothing to strand.
 */
export async function mayRemovePassword(db: Database, identityId: string): Promise<boolean> {
  return mayRemovePasswordForUser(db, await liveUserFor(db, identityId));
}

/** As `mayRemovePassword`, against an already-resolved live user row. */
export async function mayRemovePasswordForUser(db: Database, u: LiveUser): Promise<boolean> {
  if (!u) return true;
  const rows = await db
    .select({ id: account.id, providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, u.id));
  if (!rows.some((r) => r.providerId === CREDENTIAL)) return true;
  // A strong factor other than this password is a way back in. Shares
  // STRONG_PROVIDERS with hasStrongAuthFactor() (auth-factors.ts) so the two
  // can never disagree about what counts as durable. Can't delegate to
  // hasStrongAuthFactor() directly: it treats the credential row itself as a
  // strong factor, and we need "strong factor OTHER than this password" — an
  // unrecognized providerId (a future provider, a stale linked-account row)
  // must NOT count, exactly like it doesn't for hasStrongAuthFactor().
  const otherStrongProviders: readonly string[] = STRONG_PROVIDERS.filter((p) => p !== CREDENTIAL);
  if (rows.some((r) => otherStrongProviders.includes(r.providerId))) return true;
  const passkeys = await db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.userId, u.id));
  if (passkeys.length > 0) return true;
  // A real verified address can drive a reset. Reuses the reset gate so the two
  // can never disagree about what counts as a usable address.
  return mayReceivePasswordReset({ email: u.email, emailVerified: u.emailVerified });
}
