/**
 * Method constants (stage-calibration spec §4.11). All tier 4 unless the spec says otherwise;
 * the report prints them. `LIVE_CAL` is the real build, `FIXTURE_CAL` the small fixture-0 build.
 */
import type { CalProfile } from './types';

export const LIVE_CAL: CalProfile = {
  name: 'live',
  nSpellsMin: 30,
  nEventsMin: 20,
  nRiskMin: 20,
  kMax: 240,
  tailSpan: 24,
  tailMinEvents: 5,
  minBinEvents: 10,
  ridgeLambda: 1,
  initMinEvents: 100,
  sizeMinN: 30,
  revMinN: 30,
  v27N: 100000,
  v27Tol: 0.005,
  coverageGuard: true,
  purgeMinExits: 10,
  purgeRatio: 10,
  purgeMinDays: 730,
  purgeGapDays: 30,
  phPrior: 5,
  phaseMinUnits: 10,
  phaseMinGaps: 10,
  fixtureInitiation: false,
  backcastGate: true
};

export const FIXTURE_CAL: CalProfile = {
  name: 'fixture',
  nSpellsMin: 3,
  nEventsMin: 2,
  nRiskMin: 2,
  kMax: 240,
  tailSpan: 24,
  tailMinEvents: 1,
  minBinEvents: 1,
  ridgeLambda: 1,
  initMinEvents: null,
  sizeMinN: 2,
  revMinN: 2,
  v27N: 100000,
  v27Tol: 0.005,
  coverageGuard: false,
  purgeMinExits: 10,
  purgeRatio: 10,
  purgeMinDays: 730,
  purgeGapDays: 30,
  phPrior: 5,
  phaseMinUnits: 10,
  phaseMinGaps: 1,
  fixtureInitiation: true,
  backcastGate: false
};
