// Shared fixtures for the finance specs. Relative imports only (the import guard scans this folder).
import { MARKET_TERMS, resolveTerms } from '../terms';
import { PROTOTYPES } from '../prototypes';
import type { BundleItem } from '../instruments';

export const B = PROTOTYPES[1];
export const TERMS = resolveTerms();
export const TERMS_CUT = resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01 });
export const SLOPE_FIXTURE = 1.75;

const U = 861525;

/** The baseline affordable funding: federal, state and City grants (row F12's dollars over U). */
export const BASELINE_BUNDLE: BundleItem[] = [
  { instrument: { kind: 'grant', share: 443108 / U }, poolKind: 'federal' },
  { instrument: { kind: 'grant', share: 118390 / U }, poolKind: 'state' },
  { instrument: { kind: 'grant', share: 300027 / U }, poolKind: 'generalRevenue' }
];

/** The same, with the City money split between two City pools (a test split, not data). */
export const BASELINE_SPLIT: BundleItem[] = [
  { instrument: { kind: 'grant', share: 443108 / U }, poolKind: 'federal' },
  { instrument: { kind: 'grant', share: 118390 / U }, poolKind: 'state' },
  { instrument: { kind: 'grant', share: 150000 / U }, poolKind: 'dedicatedTax' },
  { instrument: { kind: 'grant', share: 150027 / U }, poolKind: 'goBond' }
];
