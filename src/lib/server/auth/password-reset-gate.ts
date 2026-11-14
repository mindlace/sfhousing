import { isDeliverable } from '$lib/server/email/provider';

/**
 * May this address receive a password-reset email?
 *
 * Two refusals, both deliberate — do NOT relax either into unconditional sending:
 *
 *  1. SYNTHETIC address — a pseudonymous account's `PSEUDONYMOUS_EMAIL_DOMAIN` address is
 *     undeliverable (`isDeliverable`). Sending there is a silent no-op that looks to the user like a
 *     mail that was sent and never arrived.
 *  2. UNVERIFIED address — an unverified address is a claim, not a credential.
 *     Mailing a reset to one lets someone who typed another person's address
 *     (e.g. into any form that accepts an address) pull a reset token for it.
 *
 * A user with no verified email has no reset path. That is inherent to
 * pseudonymity, not a gap. See the design spec, sections 3 and 9.
 */
export function mayReceivePasswordReset(args: { email: string; emailVerified: boolean }): boolean {
  return args.emailVerified && isDeliverable(args.email);
}
