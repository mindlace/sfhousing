import { describe, expect, it } from 'vitest';
import * as finance from './index';

const NAMES = [
  'PROTOTYPES',
  'prototypeFor',
  'uncoveredPerHome',
  'costPerHome',
  'LAND_PER_HOME',
  'AFFORDABLE',
  'PROTOTYPE_BINNING',
  'MARKET_TERMS',
  'TYPED_TERM_RANGES',
  'resolveTerms',
  'isResolvedTerms',
  'CONSTRUCTION_LOAN_TO_COST',
  'DRAW_UP_FRONT',
  'AVERAGE_DRAWN',
  'grantEquivalentPerHome',
  'coverage',
  'oddsShift',
  'CERTAIN_TOLERANCE',
  'isCertain',
  'termsNeeded',
  'missingTerms',
  'INSTRUMENT_BOUNDS',
  'validateInstrument',
  'fundBundle',
  'projectDollars',
  'AMI_TIER_BOUNDS',
  'tierOfAmi',
  'INCLUSIONARY',
  'ASSUMED_TENURE',
  'inclusionaryUnits',
  'DISPLACEMENT_RANGE',
  'debtService',
  'DEBT_BOUNDS',
  'validateDebt',
  'DEBT_LIMITS',
  'limitStatements'
];

describe('finance index', () => {
  it('re-exports every public runtime name', () => {
    const present = Object.keys(finance);
    for (const name of NAMES) expect(present, name).toContain(name);
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(finance).sort()).toEqual([...NAMES].sort());
  });
});
