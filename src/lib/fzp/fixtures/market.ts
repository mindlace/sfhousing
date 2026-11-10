/** A live-shape market model (counts as spec 4.11 quotes them), for the market sentence tests. */
import type { Calibration, MarketModel } from '$lib/timelapse/types';
import { fixtureCalibration } from './calibration';

export const LIVE_MARKET: MarketModel = {
  today: {
    all: Math.log(129 / 245.521),
    private: Math.log(116 / 245.521),
    years: [2023, 2025],
    observed: { all: 129, private: 116 },
    implied: 245.521,
    provenance: {
      tier: 2,
      label: "Starts in the last three panel years against the start model's expectation",
      sources: [],
      method: 'ln(observed starts / implied starts)'
    }
  },
  crossCheck: {
    logOdds: -1.28933,
    provenance: { tier: 3, label: "The Controller's development model", sources: [], method: 'x' }
  },
  slope: {
    perCostShare: 1.74,
    provenance: { tier: 3, label: 'x', sources: [], method: 'x' },
    crossChecks: {
      costCoefficient: 0,
      priceCoefficient: 0,
      provenance: { tier: 3, label: 'x', sources: [], method: 'x' }
    }
  }
};

/** The fixture calibration with a live-shape market and a 2007 to 2025 initiation window. */
export function liveMarketCalibration(): Calibration {
  const cal = structuredClone(fixtureCalibration());
  cal.market = structuredClone(LIVE_MARKET);
  cal.initiation.provenance.window = ['2007-01-01', '2025-12-31'];
  return cal;
}

/** The fixture shape: counts 10, 9, 20 and no initiation window. */
export function fixtureMarketCalibration(): Calibration {
  const cal = structuredClone(fixtureCalibration());
  const m = structuredClone(LIVE_MARKET);
  m.today.observed = { all: 10, private: 9 };
  m.today.implied = 20;
  m.today.all = Math.log(10 / 20);
  m.today.private = Math.log(9 / 20);
  cal.market = m;
  delete cal.initiation.provenance.window;
  return cal;
}
