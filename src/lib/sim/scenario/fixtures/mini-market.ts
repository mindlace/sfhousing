// A tier-4 market model for tests that need `calibration.market` (the mini calibration has none).
import type { Calibration, MarketModel, Provenance } from '$lib/timelapse/types';

const provenance: Provenance = {
  tier: 4,
  label: 'test fixture',
  sources: [],
  method: 'invented for tests'
};

export const miniMarket = (): MarketModel => ({
  today: {
    all: -0.4,
    private: -0.7,
    years: [2022, 2024],
    observed: { all: 300, private: 200 },
    implied: 447,
    provenance
  },
  crossCheck: { logOdds: -0.5, provenance },
  slope: {
    perCostShare: 1.2,
    provenance,
    crossChecks: { costCoefficient: -1, priceCoefficient: 1, provenance }
  }
});

/** An empty baseline funding: present, with no pools. */
export const miniFunding = (): NonNullable<Calibration['baselineFunding']> => ({
  pools: [],
  programmes: [],
  provenance: [],
  check: { impliedHomesPerYear: 0, observedHomesPerYear: 0, provenance }
});
