// The finance model's public surface: sourced constants and the arithmetic of public money.
// Pure; relative imports only. See docs/dev/finance-model.md.
export type { Evidence, Sourced, Unsourced } from './evidence';
export {
  AFFORDABLE,
  LAND_PER_HOME,
  PROTOTYPES,
  PROTOTYPE_BINNING,
  costPerHome,
  prototypeFor,
  uncoveredPerHome
} from './prototypes';
export type { Prototype, PrototypeId } from './prototypes';
export {
  AVERAGE_DRAWN,
  CONSTRUCTION_LOAN_TO_COST,
  DRAW_UP_FRONT,
  MARKET_TERMS,
  TYPED_TERM_RANGES,
  isResolvedTerms,
  resolveTerms
} from './terms';
export type { MarketTerms, ResolvedTerms, TermKey } from './terms';
export {
  CERTAIN_TOLERANCE,
  INSTRUMENT_BOUNDS,
  coverage,
  fundBundle,
  grantEquivalentPerHome,
  isCertain,
  missingTerms,
  oddsShift,
  projectDollars,
  termsNeeded,
  validateInstrument
} from './instruments';
export type { BundleFunding, BundleItem, ItemFunding } from './instruments';
export {
  AMI_TIER_BOUNDS,
  ASSUMED_TENURE,
  DISPLACEMENT_RANGE,
  INCLUSIONARY,
  inclusionaryUnits,
  tierOfAmi
} from './tiers';
export type { InclusionaryBand, Tenure } from './tiers';
export { DEBT_BOUNDS, DEBT_LIMITS, debtService, limitStatements, validateDebt } from './debt';
export type { Borrowing } from './debt';
