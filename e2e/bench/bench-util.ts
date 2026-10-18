// Shared by the bench:map files (docs/dev/map-perf.md).

/** The pass bar: p95 frame time in ms (60 fps). */
export const BAR_MS = 16.7;

/** Nearest-rank percentile of an ascending-sorted array. */
export function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export const verdict = (p95: number): string => (p95 <= BAR_MS ? 'PASS' : 'FAIL');
