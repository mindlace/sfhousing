/**
 * Shared rounding of calibration probabilities (stage-calibration spec §4.7, §4.8, §4.9): 6
 * decimals through integer micro-units, so a rounded set can be made to sum to exactly 1.
 */
const MICRO = 1_000_000;

/** `x` rounded to 6 decimals. */
export function round6(x: number): number {
  return Math.round(x * MICRO) / MICRO;
}

/**
 * `xs` normalised by their sum and rounded to 6 decimals, the rounding residual added to the
 * first largest value, so the result sums to 1 (in micro-units). The sum must be > 0.
 */
export function roundShares(xs: number[]): number[] {
  const total = xs.reduce((a, b) => a + b, 0);
  const micro = xs.map((x) => Math.round((x / total) * MICRO));
  let largest = 0;
  for (let i = 1; i < micro.length; i++) if (micro[i] > micro[largest]) largest = i;
  micro[largest] += MICRO - micro.reduce((a, b) => a + b, 0);
  return micro.map((m) => m / MICRO);
}
