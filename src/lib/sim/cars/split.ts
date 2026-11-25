/** floor(x + u), u in (0, 1). */
export function roundSystematic(x: number, u: number): number {
  return Math.floor(x + u);
}

/**
 * Systematic split of n into `out.length` parts by weight: out[i] = floor(n*C_i + u) -
 * floor(n*C_(i-1) + u), C the cumulative weight share (the last exactly 1, so the parts sum to n).
 * Each part is within 1 of n times its share. Zero total weight with n > 0 throws.
 */
export function splitSystematic(
  n: number,
  weights: ArrayLike<number>,
  u: number,
  out: Int32Array
): void {
  const len = weights.length;
  let total = 0;
  for (let i = 0; i < len; i++) total += weights[i];
  if (n > 0 && !(total > 0)) throw new RangeError('splitSystematic: zero total weight');
  let acc = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    acc += weights[i];
    const cum = i === len - 1 ? n : roundSystematic(n * (acc / total), u);
    out[i] = cum - prev;
    prev = cum;
  }
}
