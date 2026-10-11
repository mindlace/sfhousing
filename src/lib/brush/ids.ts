const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const LENGTH = 12;
/** 232 = 58 × 4: bytes at or above it are rejected so `b % 58` stays unbiased. */
const LIMIT = 232;

const defaultRand = (buf: Uint8Array): Uint8Array => {
  crypto.getRandomValues(buf as Uint8Array<ArrayBuffer>);
  return buf;
};

/** A 12-character base58 op id (spec §4.4). Ids do not affect resolution. */
export function newOpId(rand: (buf: Uint8Array) => Uint8Array = defaultRand): string {
  let id = '';
  const buf: Uint8Array = new Uint8Array(16);
  while (id.length < LENGTH) {
    for (const b of rand(buf)) {
      if (b >= LIMIT) continue;
      id += ALPHABET[b % 58];
      if (id.length === LENGTH) break;
    }
  }
  return id;
}
