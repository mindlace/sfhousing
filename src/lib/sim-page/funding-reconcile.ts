/**
 * Reconcile a loaded policy's funding with the calibration it will run on (finance-levers spec
 * section 4.5, F15). Scales and programmes the data cannot honour are dropped and reported. It
 * never rejects a document, and returns the same `funding` object when nothing changes, so a
 * reload does not nag (the house rule, reconcile.ts). Pure TS: the server imports it.
 */
import { MARKET_TERMS, missingTerms, resolveTerms } from '$lib/sim/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import type { Calibration, Day, TermKey } from '$lib/timelapse/types';
import { DEFAULT_POLICY, canonicalJson } from './policy';

export interface FundingLoadReport {
  /** 2 when this load upgraded a schema-2 document (it now carries DEFAULT_POLICY.funding). */
  upgradedFrom: 2 | null;
  /** baselineScale entries removed because the data has no such baseline pool, in document order. */
  droppedScales: { pool: string; from: Day }[];
  /** Programmes removed, in document order. */
  droppedProgrammes: {
    id: string;
    label: string;
    pool: string;
    /** 'pool': names a baseline pool the data lacks. 'term': needs a market term that is
     *  neither sourced nor typed (F8). */
    reason: 'pool' | 'term';
    /** The first missing term, for reason 'term'; null otherwise. */
    term: TermKey | null;
  }[];
  /** The data cannot run money (no `market` or no `baselineFunding`) and the funding left after
   *  the drops is not DEFAULT_POLICY.funding: it is kept but not used (section 4.4 step 1). */
  unusable: boolean;
}

export function reconcileFunding(
  f: FinanceLevers,
  cal: Calibration
): { funding: FinanceLevers; report: Omit<FundingLoadReport, 'upgradedFrom'> } {
  const baseline = new Set((cal.baselineFunding?.pools ?? []).map((p) => p.id));
  const terms = resolveTerms(MARKET_TERMS, f.terms);

  const droppedScales: FundingLoadReport['droppedScales'] = [];
  const baselineScale = f.baselineScale.filter((s) => {
    if (baseline.has(s.pool)) return true;
    droppedScales.push({ pool: s.pool, from: s.from });
    return false;
  });

  const droppedProgrammes: FundingLoadReport['droppedProgrammes'] = [];
  const programmes = f.programmes.filter((p) => {
    const drop = (reason: 'pool' | 'term', term: TermKey | null) => {
      droppedProgrammes.push({ id: p.id, label: p.label, pool: p.pool, reason, term });
      return false;
    };
    if (!p.pool.startsWith('u-') && !baseline.has(p.pool)) return drop('pool', null);
    const missing = missingTerms(p.instrument, terms);
    return missing.length > 0 ? drop('term', missing[0]) : true;
  });

  const changed = droppedScales.length > 0 || droppedProgrammes.length > 0;
  const funding = changed ? { ...f, baselineScale, programmes } : f;
  const unusable =
    (cal.market === undefined || cal.baselineFunding === undefined) &&
    canonicalJson(funding) !== canonicalJson(DEFAULT_POLICY.funding);
  return { funding, report: { droppedScales, droppedProgrammes, unusable } };
}
