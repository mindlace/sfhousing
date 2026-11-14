import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { survivorId } from '$lib/server/user-store/user';
import { hasStrongAuthFactor } from '$lib/server/user-store/auth-factors';

/** The resolution for a signed-out cold-accept submission (spec §4 cases A/B/C). */
export type ColdDecision =
  // B (no invitedEmail: handle invite) or A1 (entered === invited, unknown account).
  // pseudonymous: true iff the invite carries no invitedEmail (handle invite) — an
  // emailed invite always mints email-bound (durable, unverified), never pseudonymous.
  | { kind: 'mint'; pseudonymous: boolean }
  | { kind: 'signin'; strongFactor: boolean; userId: string } // A2 / A3
  | { kind: 'verify'; email: string }; // C

/** A2/A3 signin decision for an email that owns an account, else null. */
async function signinForEmail(db: Database, email: string): Promise<ColdDecision | null> {
  const [row] = await db
    .select({ userIdentity: user.userIdentity })
    .from(user)
    .where(eq(user.email, email));
  if (!row) return null;
  const sid = (await survivorId(db, row.userIdentity)) ?? row.userIdentity;
  return { kind: 'signin', strongFactor: await hasStrongAuthFactor(db, sid), userId: sid };
}

/**
 * Classify a cold-accept form submission. The bearer token proves control of the
 * INVITED inbox; this decides what the entered email maps to.
 *
 * - blank entered, no invitedEmail → B (handle invite): mint pseudonymous
 * - blank entered OR entered === invited, with an invitedEmail:
 *   the INVITED address decides — no account → A1/B: mint email-bound;
 *   account exists → A2/A3: sign in (strongFactor decides which). Mint is
 *   unreachable whenever the invited email owns an account, so clearing the
 *   prefilled field can never produce a doomed mint against UNIQUE(email).
 * - entered !== invited            → C: verify the new address via magic link
 */
export async function classifyColdAccept(args: {
  db: Database;
  invitedEmail: string | null;
  enteredEmail: string;
}): Promise<ColdDecision> {
  const entered = args.enteredEmail.trim().toLowerCase();
  const invited = args.invitedEmail?.trim().toLowerCase() ?? null;
  if (!invited && !entered) return { kind: 'mint', pseudonymous: true }; // B (handle invite)
  if (invited && (!entered || entered === invited)) {
    const signin = await signinForEmail(args.db, invited);
    if (signin) return signin; // A2/A3
    return { kind: 'mint', pseudonymous: false }; // A1 / B with an unclaimed invited email
  }
  return { kind: 'verify', email: entered }; // C
}
