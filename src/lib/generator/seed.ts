const encoder = new TextEncoder();

/** I14: FNV-1a 32-bit over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  // The city identifiers and named streams are ASCII. Avoid allocating UTF-8 buffers for them.
  let ascii = true;
  for (let i = 0; i < s.length; i++)
    if (s.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  if (ascii) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  const bytes = encoder.encode(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: integer ops only, bit-identical in every engine. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
