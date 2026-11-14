/**
 * Length-only password policy. There are deliberately NO composition rules
 * (required digits, symbols, mixed case): they push users toward `Password1!`
 * while degrading memorability, and NIST SP 800-63B recommends against them.
 * Strength comes from length plus the `haveibeenpwned` breach check wired in
 * better-auth.ts — "has this exact password already leaked?" is a real signal;
 * character classes are not.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 64;

export type PasswordShape = { ok: true } | { ok: false; reason: 'too-short' | 'too-long' };

/** Length check by CODE POINT, so astral characters count as one each. */
export function validatePasswordShape(raw: string): PasswordShape {
  const len = [...raw].length;
  if (len < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too-short' };
  if (len > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true };
}
