// The bench city's public-money fixtures (finance-engine spec 4.17). Test values, not data: every
// number here is a tier 4 bench value, chosen to load the engine (the sources the spec names for
// some of them only say where the magnitudes come from). Browser-safe: no `node:` imports.
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
import type { Day } from '$lib/timelapse/time';
import type {
  Calibration,
  Inflow,
  MarketModel,
  Pool,
  PoolKind,
  Programme,
  Provenance
} from '$lib/timelapse/types';
import type { SimInput } from '../types';

type Finance = NonNullable<SimInput['finance']>;

/** A placeholder source, as the mini fixtures use: the calibration check wants one. */
const BENCH_SOURCE = { label: 'Bench fixture', url: 'https://example.org/bench-fixture' };

const provenance = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ ...BENCH_SOURCE }],
  method: 'A bench value on the synthetic bench city (finance-engine spec 4.17), not data.'
});

/**
 * The bench `affordableRoutes`: the pathway shares of 100% affordable projects (16, 36 and 1 of
 * 53), labelled tier 4 here because the bench city is synthetic.
 */
export function benchRoutes(): NonNullable<Calibration['affordableRoutes']> {
  return {
    discretionary: 16 / 53,
    streamlined: 36 / 53,
    permitOnly: 1 / 53,
    provenance: {
      tier: 4,
      label: 'Bench affordable routes (tier 4)',
      sources: [{ ...BENCH_SOURCE }],
      method:
        'The pathway shares of 53 projects of 10 homes or more proposing at least 95% ' +
        'affordable homes, used as test values on the synthetic bench city (tier 4).'
    }
  };
}

/** The bench tiers (tier 4 bench values; the engine does not read tiers). */
const BENCH_TIERS = {
  veryLow: 0.483439,
  low: 0.433384,
  moderate: 0.076402,
  aboveModerate: 0.006775
};

/** The City's six sources (Exhibit E, FY2024-25 dollars a year), as the bench's City pools. */
const CITY: readonly { id: string; kind: PoolKind; dollarsPerYear: number }[] = [
  { id: 'city-debt', kind: 'goBond', dollarsPerYear: 80_500_000 },
  { id: 'city-ocoh', kind: 'dedicatedTax', dollarsPerYear: 48_600_000 },
  { id: 'city-general-fund', kind: 'generalRevenue', dollarsPerYear: 36_700_000 },
  { id: 'city-impact-fees', kind: 'dedicatedTax', dollarsPerYear: 34_800_000 },
  { id: 'city-housing-trust-fund', kind: 'generalRevenue', dollarsPerYear: 27_400_000 },
  { id: 'city-redevelopment', kind: 'dedicatedTax', dollarsPerYear: 6_000_000 }
];
const CITY_TOTAL = 234_000_000;
const PER_HOME = { city: 300_027, state: 118_390, federal: 443_108 };
const UNCOVERED = 861_525;
const MICRO = 1_000_000;

/**
 * Shares rounded to millionths summing to exactly 1, the remainder on the largest (as the
 * pipeline's `roundShares` rounds the live baseline's).
 */
function microShares(xs: readonly number[]): number[] {
  const total = xs.reduce((a, b) => a + b, 0);
  const micro = xs.map((x) => Math.round((x / total) * MICRO));
  let largest = 0;
  for (let i = 1; i < micro.length; i++) if (micro[i] > micro[largest]) largest = i;
  micro[largest] += MICRO - micro.reduce((a, b) => a + b, 0);
  return micro.map((m) => m / MICRO);
}

/**
 * The bench baseline (spec 4.17; tier 4 bench values): six City pools at the Exhibit E amounts
 * (80.5, 48.6, 36.7, 34.8, 27.4 and 6.0 million dollars a year), a `state` pool at 150 million a
 * year, an uncapped `federal` pool, and one affordable grant per pool with the Exhibit F shares
 * (City 300,027 split by Exhibit E, state 118,390, federal 443,108, over 861,525), `minHomes` 70
 * and the expected live tiers. Bench `slope` 3.0. Every inflow is yearly from `asOf`.
 */
export function benchBaseline(asOf: Day): Finance {
  const { pools, programmes } = benchBaselineFunding(asOf);
  return { pools, programmes, off: [], slope: 3, terms: resolveTerms(MARKET_TERMS) };
}

/** `benchBaseline` as `calibration.baselineFunding` (for the host bench). */
export function benchBaselineFunding(asOf: Day): NonNullable<Calibration['baselineFunding']> {
  const yearly = (dollarsPerYear: number): Inflow[] => [
    { kind: 'yearly', from: asOf, to: null, dollarsPerYear }
  ];
  const pools: Pool[] = [
    ...CITY.map((c): Pool => ({
      id: c.id,
      kind: c.kind,
      label: c.id,
      inflows: yearly(c.dollarsPerYear),
      uncapped: false,
      debt: c.kind === 'goBond' ? { rate: 0.06, termYears: 20 } : null,
      leverage: 1
    })),
    {
      id: 'state',
      kind: 'state',
      label: 'state',
      inflows: yearly(150_000_000),
      uncapped: false,
      debt: null,
      leverage: 1
    },
    {
      id: 'federal',
      kind: 'federal',
      label: 'federal',
      inflows: [],
      uncapped: true,
      debt: null,
      leverage: 1
    }
  ];
  const perHome = [
    ...CITY.map((c) => (PER_HOME.city * c.dollarsPerYear) / CITY_TOTAL),
    PER_HOME.state,
    PER_HOME.federal
  ];
  if (Math.abs(perHome.reduce((a, b) => a + b, 0) - UNCOVERED) > 1e-6) {
    throw new Error('benchBaseline: the per-home dollars do not sum to 861,525');
  }
  const shares = microShares(perHome);
  const programmes: Programme[] = pools.map((p, i) => ({
    id: `baseline-${p.id}`,
    label: `${p.id} grant`,
    pool: p.id,
    reach: 'affordable',
    instrument: { kind: 'grant', share: shares[i] },
    from: asOf,
    to: null,
    minHomes: 70,
    tiers: { ...BENCH_TIERS }
  }));
  const prov = provenance('Bench baseline funding (tier 4)');
  return {
    pools,
    programmes,
    provenance: [...pools.map(() => prov), prov],
    check: { impliedHomesPerYear: 0, observedHomesPerYear: 0, provenance: prov }
  };
}

/**
 * The bench market model (operator ruling R-P3; tier 4 bench values): `today.private` 0, so the
 * host's private-starts level adds no shift, and `slope.perCostShare` 3.0, the bench slope.
 */
export function benchMarket(): MarketModel {
  const prov = provenance('Bench market (tier 4)');
  return {
    today: {
      all: 0,
      private: 0,
      years: [2022, 2024],
      // ln(100 ÷ 100) = 0, as the calibration check requires
      observed: { all: 100, private: 100 },
      implied: 100,
      provenance: prov
    },
    crossCheck: { logOdds: 0, provenance: prov },
    slope: {
      perCostShare: 3,
      provenance: prov,
      crossChecks: { costCoefficient: 0, priceCoefficient: 0, provenance: prov }
    }
  };
}

/**
 * The bench funding set (spec 4.17, F18: "two pools, three programmes, one of them certain"; tier
 * 4 bench values): `bench-bond` (a 300,000,000 bond on `asOf + 365`), `bench-fund` (50,000,000 a
 * year from `asOf`), the certain market grant `bench-certain` (`minHomes` 25), the market loan
 * `bench-loan` and the affordable grant `bench-afford`.
 */
export function benchFunding(asOf: Day): { pools: Pool[]; programmes: Programme[] } {
  return {
    pools: [
      {
        id: 'bench-bond',
        kind: 'goBond',
        label: 'bench-bond',
        inflows: [{ kind: 'once', day: asOf + 365, dollars: 300_000_000 }],
        uncapped: false,
        debt: { rate: 0.06, termYears: 20 },
        leverage: 1
      },
      {
        id: 'bench-fund',
        kind: 'generalRevenue',
        label: 'bench-fund',
        inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 50_000_000 }],
        uncapped: false,
        debt: null,
        leverage: 1
      }
    ],
    programmes: [
      {
        id: 'bench-certain',
        label: 'bench-certain',
        pool: 'bench-bond',
        reach: 'market',
        instrument: { kind: 'grant', share: 1 },
        from: asOf,
        to: null,
        minHomes: 25,
        tiers: null
      },
      {
        id: 'bench-loan',
        label: 'bench-loan',
        pool: 'bench-fund',
        reach: 'market',
        instrument: { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null },
        from: asOf,
        to: null,
        minHomes: 0,
        tiers: null
      },
      {
        id: 'bench-afford',
        label: 'bench-afford',
        pool: 'bench-fund',
        reach: 'affordable',
        instrument: { kind: 'grant', share: 0.25 },
        from: asOf,
        to: null,
        minHomes: 0,
        tiers: { ...BENCH_TIERS }
      }
    ]
  };
}

/** `finance` with the bench funding set added after its own pools and programmes. */
export function withBenchFunding(finance: Finance, asOf: Day): Finance {
  const add = benchFunding(asOf);
  return {
    ...finance,
    pools: [...finance.pools, ...add.pools],
    programmes: [...finance.programmes, ...add.programmes]
  };
}
