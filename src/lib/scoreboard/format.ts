// Spec §4.5. Pure; no DOM.

const MINUS = '−';
const COUNT = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ONE_DP = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

/** Exact count, en-US grouping, U+2212 for negatives. `-0` → "0". */
export function formatCount(n: number): string {
  return (n < 0 ? MINUS : '') + COUNT.format(Math.abs(n));
}

/** Floor that first snaps values within float error of an integer (0.29*100 = 28.999…). */
function snapFloor(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) <= 1e-9 * Math.max(1, Math.abs(x)) ? r : Math.floor(x);
}

/**
 * Percent of an uncapped fraction. Floors (never shows 100% before the target is met):
 * one decimal when |p| < 10, otherwise an integer. Exactly 0 → "0%".
 */
export function formatPercent(fraction: number): string {
  const p = fraction * 100;
  if (p === 0) return '0%';
  if (Math.abs(p) < 10) {
    const tenths = snapFloor(p * 10);
    return (tenths < 0 ? MINUS : '') + ONE_DP.format(Math.abs(tenths) / 10) + '%';
  }
  const whole = snapFloor(p);
  return (whole < 0 ? MINUS : '') + INT.format(Math.abs(whole)) + '%';
}

/** Mobile bar only: compact ("123.5K") when n ≥ 100,000, else the exact count. */
export function formatCompactCount(n: number): string {
  return n >= 100_000 ? COMPACT.format(n) : formatCount(n);
}

/** The literal YYYY-MM-DD prefix of a manifest `builtAt`; unchanged if there is none. */
export function formatBuiltDate(builtAt: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(builtAt);
  return m ? m[1] : builtAt;
}
