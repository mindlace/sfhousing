// Comparing two compiled timelines, and what the comparison ensemble runs (policy-timeline spec
// rules 17 and 22; S6 `firstDifference`, S13 `comparisonOf`). Pure TS.
import { DEFAULT_POLICY4, nothingInForce, type SimPolicy4 } from '$lib/timeline/policy4';
import type { FinanceFrame, PolicyTimeline } from './frame';

/** Equal as `(pools[pool].id, day, dollars)` sequences: pool indices differ with the document. */
function sameArrivals(a: FinanceFrame | null, b: FinanceFrame | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.arrivals.length !== b.arrivals.length) return false;
  for (let i = 0; i < a.arrivals.length; i++) {
    const x = a.arrivals[i];
    const y = b.arrivals[i];
    if (x.day !== y.day || x.dollars !== y.dollars) return false;
    if (a.pools[x.pool].id !== b.pools[y.pool].id) return false;
  }
  return true;
}

/**
 * The first month at which the two give frames with different ids or different arrivals, or
 * null. Months are compared up to the smaller `readyThrough()`. When nothing differs there but
 * the two are ready through different months, the answer is that smaller month plus one: a runner
 * never keeps a month it has not compared. (So a partly compiled timeline against a complete one
 * of equal content reports a difference just past what it has compiled.)
 */
export function firstDifference(a: PolicyTimeline, b: PolicyTimeline): number | null {
  const ra = a.readyThrough();
  const rb = b.readyThrough();
  const n = Math.min(ra, rb);
  for (let m = 1; m <= n; m++) {
    const fa = a.frameAt(m);
    const fb = b.frameAt(m);
    if (fa.id !== fb.id || !sameArrivals(fa.finance, fb.finance)) return m;
  }
  return ra === rb ? null : n + 1;
}

/**
 * What the comparison ensemble runs (rule 22): with nothing in force, the same document on the
 * zoning before the plan; otherwise the default document on the plan.
 */
export function comparisonOf(doc: SimPolicy4): { doc: SimPolicy4; base: 'plan' | 'preFzp' } {
  return nothingInForce(doc) ? { doc, base: 'preFzp' } : { doc: DEFAULT_POLICY4, base: 'plan' };
}
