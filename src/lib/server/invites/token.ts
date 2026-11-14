import { sha256Hex } from '$lib/sharing/hash';

/** A 32-byte random bearer token as lowercase hex (64 chars). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 hex of the token — what we persist (never the raw token). */
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}
