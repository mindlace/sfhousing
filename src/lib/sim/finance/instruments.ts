// Instrument arithmetic: grant-equivalents, coverage, certainty and validation (spec 4.4, 4.5).
// Pure; relative imports only.
import type { Dollars, Instrument, PoolKind, ProjectKind, TermKey } from '../../timelapse/types';
import { AFFORDABLE, costPerHome, uncoveredPerHome, type Prototype } from './prototypes';
import {
  AVERAGE_DRAWN,
  isResolvedTerms,
  resolveTerms,
  type MarketTerms,
  type ResolvedTerms
} from './terms';

export const CERTAIN_TOLERANCE = 1e-9;

/** A project is certain when its coverage reaches 1, to within floating-point noise. */
export function isCertain(coverage: number): boolean {
  return coverage >= 1 - CERTAIN_TOLERANCE;
}

export interface BundleItem {
  instrument: Instrument;
  poolKind: PoolKind;
}

/** The one set of instrument bounds (row F6), inclusive unless written `gt`. */
export const INSTRUMENT_BOUNDS = {
  share: { gt: 0, max: 1 },
  costShare: { gt: 0, max: 1 },
  rate: { min: 0, max: 0.25 },
  requiredReturn: { min: 0.01, max: 0.25 },
  reserve: { min: 0, max: 1 }
} as const;

const B = INSTRUMENT_BOUNDS;

function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** The first failing message for an instrument, or null when it is valid. */
export function validateInstrument(inst: Instrument): string | null {
  const costMsg = 'A loan or guarantee covers more than 0% and at most 100% of the cost.';
  switch (inst?.kind) {
    case 'grant':
      return fin(inst.share) && inst.share > B.share.gt && inst.share <= B.share.max
        ? null
        : 'A grant pays more than 0% and at most 100% of the uncovered cost.';
    case 'loan':
      if (!(
        fin(inst.costShare) &&
        inst.costShare > B.costShare.gt &&
        inst.costShare <= B.costShare.max
      )) {
        return costMsg;
      }
      if (!(fin(inst.rate) && inst.rate >= B.rate.min && inst.rate <= B.rate.max)) {
        return "A loan's rate is between 0% and 25%.";
      }
      if (
        inst.requiredReturn !== null &&
        !(
          fin(inst.requiredReturn) &&
          inst.requiredReturn >= B.requiredReturn.min &&
          inst.requiredReturn <= B.requiredReturn.max
        )
      ) {
        return 'The return the lent money accepts is between 1% and 25%.';
      }
      return null;
    case 'guarantee':
      if (!(
        fin(inst.costShare) &&
        inst.costShare > B.costShare.gt &&
        inst.costShare <= B.costShare.max
      )) {
        return costMsg;
      }
      if (!(fin(inst.reserve) && inst.reserve >= B.reserve.min && inst.reserve <= B.reserve.max)) {
        return "A guarantee's reserve is between 0% and 100% of the loan.";
      }
      return null;
    default:
      return 'Unknown instrument kind.';
  }
}

/** The market terms the instrument's arithmetic reads, in the order they are checked. */
export function termsNeeded(inst: Instrument): TermKey[] {
  switch (inst.kind) {
    case 'grant':
      return [];
    case 'loan':
      return inst.requiredReturn !== null
        ? ['constructionRate', 'constructionYears', 'requiredReturn']
        : ['constructionRate', 'constructionYears'];
    case 'guarantee':
      return ['constructionYears', 'guaranteeRateCut'];
  }
}

function resolved(terms: MarketTerms | ResolvedTerms): ResolvedTerms {
  return isResolvedTerms(terms) ? terms : resolveTerms(terms);
}

/** The terms `inst` needs whose resolved value is null, in `termsNeeded` order. */
export function missingTerms(inst: Instrument, terms: MarketTerms | ResolvedTerms): TermKey[] {
  const t = resolved(terms);
  return termsNeeded(inst).filter((k) => t[k] === null);
}

/** Throws RangeError for an invalid instrument or a missing term. */
function checkPriceable(inst: Instrument, t: ResolvedTerms): void {
  const msg = validateInstrument(inst);
  if (msg !== null) throw new RangeError(msg);
  const missing = termsNeeded(inst).find((k) => t[k] === null);
  if (missing !== undefined) {
    throw new RangeError(`${inst.kind} needs ${missing}, which is not sourced`);
  }
}

/**
 * Exact (unrounded, loan-capped) grant-equivalent per home. The caller has checked the
 * instrument and the terms.
 */
function exactGrantEquivalent(
  inst: Instrument,
  kind: ProjectKind,
  p: Prototype,
  t: ResolvedTerms
): number {
  const U = uncoveredPerHome(kind, p);
  const C = costPerHome(kind, p);
  switch (inst.kind) {
    case 'grant':
      return inst.share * U;
    case 'loan': {
      const V = kind === 'market' ? C - p.shortfallPerHome : AFFORDABLE.value.ownPerHome;
      const principal = inst.costShare * C;
      const rateT = t.constructionRate as number;
      const years = t.constructionYears as number;
      let value = principal * Math.max(0, rateT - inst.rate) * years * AVERAGE_DRAWN.value;
      const marketReturn = t.requiredReturn;
      if (
        inst.requiredReturn !== null &&
        marketReturn !== null &&
        inst.requiredReturn < marketReturn
      ) {
        value += inst.costShare * V * (marketReturn / inst.requiredReturn - 1);
      }
      return Math.min(value, principal);
    }
    case 'guarantee':
      return (
        inst.costShare *
        C *
        (t.guaranteeRateCut as number) *
        (t.constructionYears as number) *
        AVERAGE_DRAWN.value
      );
  }
}

/** Dollars a grant would have to pay per home to be worth the same to the project. */
export function grantEquivalentPerHome(
  inst: Instrument,
  kind: ProjectKind,
  p: Prototype,
  terms: MarketTerms | ResolvedTerms
): Dollars {
  const t = resolved(terms);
  checkPriceable(inst, t);
  return Math.round(exactGrantEquivalent(inst, kind, p, t));
}

function checkG(g: number): void {
  if (!Number.isFinite(g) || g < 0) {
    throw new RangeError(`grant-equivalent must be a finite number of 0 or more; got ${g}`);
  }
}

/** Share of the uncovered cost a grant-equivalent of `g` covers, unrounded and uncapped. */
export function coverage(g: Dollars, kind: ProjectKind, p: Prototype): number {
  checkG(g);
  return g / uncoveredPerHome(kind, p);
}

/** The log-odds shift of a grant-equivalent of `g`, unrounded and uncapped. */
export function oddsShift(g: Dollars, kind: ProjectKind, p: Prototype, slope: number): number {
  checkG(g);
  return (slope * g) / costPerHome(kind, p);
}

/** The one place exact per-home amounts become whole project dollars. */
export function projectDollars(perHome: number, homes: number): Dollars {
  return Math.round(perHome * homes);
}
