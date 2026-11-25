// Iterative proportional fitting (raking) of seed record weights to categorical margins, the
// method PopulationSim uses to place PUMS households in block groups. Deterministic: plain
// arithmetic in a fixed order.

/**
 * Rake `seed` (one weight per record) so that, for every margin m, the weights of the records in
 * class c (`rows[m][i] === c`) sum to `targets[m][c]`. Each pass scales each margin in turn. A class
 * with a zero target empties its records; a class with a target but no record can never be met.
 * Stops when every reachable class is within `tol` (relative) or after `maxIter` passes.
 * `maxRelErr` is the largest relative miss over every class with a target above zero (1 for an
 * unreachable one). Margin totals should agree; when they do not, the last margin wins.
 */
export function balance(
  seed: Float64Array,
  rows: Int32Array[],
  targets: Float64Array[],
  opts: { maxIter: number; tol: number }
): { weights: Float64Array; maxRelErr: number; iterations: number } {
  const n = seed.length;
  const w = Float64Array.from(seed);
  if (rows.length === 0) return { weights: w, maxRelErr: 0, iterations: 0 };
  const sums = targets.map((t) => new Float64Array(t.length));
  const tally = (m: number) => {
    const s = sums[m];
    s.fill(0);
    const r = rows[m];
    for (let i = 0; i < n; i++) s[r[i]] += w[i];
  };
  /** Largest relative miss; `reachableOnly` skips classes with no seed weight. */
  const err = (reachableOnly: boolean) => {
    let worst = 0;
    for (let m = 0; m < rows.length; m++) {
      tally(m);
      const t = targets[m];
      const s = sums[m];
      for (let c = 0; c < t.length; c++) {
        if (!(t[c] > 0)) continue;
        if (reachableOnly && !(s[c] > 0)) continue;
        const e = Math.abs(s[c] - t[c]) / t[c];
        if (e > worst) worst = e;
      }
    }
    return worst;
  };
  const factor = new Float64Array(Math.max(...targets.map((t) => t.length)));
  let iterations = 0;
  while (iterations < opts.maxIter) {
    iterations++;
    for (let m = 0; m < rows.length; m++) {
      tally(m);
      const t = targets[m];
      const s = sums[m];
      for (let c = 0; c < t.length; c++) factor[c] = s[c] > 0 ? t[c] / s[c] : 0;
      const r = rows[m];
      for (let i = 0; i < n; i++) w[i] *= factor[r[i]];
    }
    if (err(true) < opts.tol) break;
  }
  return { weights: w, maxRelErr: err(false), iterations };
}
