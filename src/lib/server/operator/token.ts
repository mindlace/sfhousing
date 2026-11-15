/** The shortest secret that authorizes anything; a shorter one denies every request. */
export const TOKEN_MIN = 32;

const BEARER = 'Bearer ';

/**
 * Whether `header` is `Bearer <token>` with `token` equal to `secret`. Fails closed: false
 * unless `secret` is a string of at least TOKEN_MIN characters, so an unset, empty or short
 * secret denies every request. Checks the length first, then compares the SHA-256 digests of
 * the two in constant time (an XOR over the 32 bytes). Neither value is logged or returned.
 */
export async function bearerMatches(
  header: string | null,
  secret: string | undefined
): Promise<boolean> {
  if (typeof secret !== 'string' || secret.length < TOKEN_MIN) return false;
  if (typeof header !== 'string' || !header.startsWith(BEARER)) return false;
  const token = header.slice(BEARER.length);
  if (token.length !== secret.length) return false;
  const [a, b] = await Promise.all([digest(token), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
