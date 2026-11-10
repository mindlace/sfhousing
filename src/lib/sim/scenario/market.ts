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
 * F3: the one rule for the level the engine runs. Release 1: always 'all'. finance-engine changes
 * it to 'private' when `calibration.baselineFunding` is present.
 */
export function marketLevel(calibration: Calibration): 'all' | 'private' {
  void calibration;
  return 'all';
}

export const NO_MARKET_WARNING =
  'calibration.json: no market model; the run uses the 2007-2025 average market';
