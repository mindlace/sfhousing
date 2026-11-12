// The market baseline's one rule for which level the engine runs and the steps it is given
// (spec 4.9, F3). Pure; the engine reads the steps from `SimInput.market`.
import type { Day } from '$lib/timelapse/time';
import type { Calibration, MarketModel, MarketStep } from '$lib/timelapse/types';

/** Today's market as the run's steps: one step at `asOf`, or none without a model. */
export function marketSteps(
  m: MarketModel | undefined,
  asOf: Day,
  level: 'all' | 'private'
): MarketStep[] {
  return m ? [{ from: asOf, logOdds: m.today[level] }] : [];
}

/**
 * F3: the one rule for the level the engine runs: 'private' exactly when `buildSimInput` also sets
 * `finance` from the calibration's baseline funding (F12), else 'all'.
 */
export function marketLevel(calibration: Calibration): 'all' | 'private' {
  return calibration.market !== undefined && calibration.baselineFunding !== undefined
    ? 'private'
    : 'all';
}

export const NO_MARKET_WARNING =
  'calibration.json: no market model; the run uses the 2007-2025 average market';

export const FUNDING_WITHOUT_MARKET_WARNING =
  'calibration.json: baselineFunding without a market model; the run has no funding';
