// Funding fixtures for the lever specs: a four-pool baseline in the shape of the live one, and
// funding levers at the smallest and at the largest size the parser accepts. Tier 4 values.
import { resolveTerms } from '$lib/sim/finance';
import type { SimInput } from '$lib/sim/scenario/types';
import { dayOf } from '$lib/sim/scenario/dates';
import type { Calibration, Day, Pool, Programme, TermKey } from '$lib/timelapse/types';
import type { FinanceLevers } from '../types';

/** 15 March 2026: mid-year, so the next fiscal year starts 2027-07-01 and the next calendar 2027-01-01. */
export const FIXTURE_AS_OF: Day = dayOf(2026, 3, 15);

type BaselineFinance = NonNullable<SimInput['finance']>;
type BaselineFunding = NonNullable<Calibration['baselineFunding']>;

const TIERS = { veryLow: 0.428572, low: 0.428571, moderate: 0.142857, aboveModerate: 0 };

function pool(
  id: string,
  kind: Pool['kind'],
  inflows: Pool['inflows'],
  uncapped = false,
  debt: Pool['debt'] = null
): Pool {
  return { id, kind, label: id, inflows, uncapped, debt, leverage: 1 };
}

function grant(poolId: string, share: number): Programme {
  return {
    id: `baseline-${poolId}`,
    label: `${poolId}: grant`,
    pool: poolId,
    reach: 'affordable',
    instrument: { kind: 'grant', share },
    from: FIXTURE_AS_OF,
    to: null,
    minHomes: 2,
    tiers: { ...TIERS }
  };
}

function build(asOf: Day, cityAFrom: Day): ReturnType<typeof baselineFixture> {
  const yearly = (from: Day, dollarsPerYear: number): Pool['inflows'] => [
    { kind: 'yearly', from, to: null, dollarsPerYear }
  ];
  const pools = [
    pool('city-a', 'goBond', yearly(cityAFrom, 6_000_000), false, { rate: 0.06, termYears: 20 }),
    pool('city-b', 'generalRevenue', yearly(asOf, 4_000_000)),
    pool('state', 'state', yearly(asOf, 3_000_000)),
    pool('federal', 'federal', [], true)
  ];
  const shares = [0.2, 0.148251, 0.137419, 0.51433];
  const programmes = pools.map((p, i) => ({ ...grant(p.id, shares[i]), from: asOf }));
  const prov = {
    tier: 4 as const,
    label: 'fixture',
    sources: [{ label: 'fixture', url: 'https://example.org/fixture' }],
    method: 'fixture'
  };
  return {
    finance: {
      pools,
      programmes,
      off: [],
      slope: 1.75,
      terms: resolveTerms()
    },
    baselineFunding: {
      pools: structuredClone(pools),
      programmes: structuredClone(programmes),
      provenance: Array.from({ length: pools.length + 1 }, () => ({ ...prov })),
      check: { impliedHomesPerYear: 20, observedHomesPerYear: 25, provenance: { ...prov } }
    }
  };
}

export function baselineFixture(asOf: Day = FIXTURE_AS_OF): {
  finance: BaselineFinance;
  baselineFunding: BaselineFunding;
} {
  return build(asOf, asOf);
}

/** As `baselineFixture()`, with `city-a`'s yearly inflow starting on 29 February 2028. */
export function leapBaseline(): {
  finance: BaselineFinance;
  baselineFunding: BaselineFunding;
} {
  return build(FIXTURE_AS_OF, dayOf(2028, 2, 29));
}

/** One scale entry, one added pool, one programme. */
export function fundingOnly(): FinanceLevers {
  return {
    baselineScale: [{ pool: 'state', from: FIXTURE_AS_OF + 400, scale: 2 }],
    pools: [
      {
        id: 'u-pool-1',
        kind: 'generalRevenue',
        label: 'Added pool',
        inflows: [{ kind: 'once', day: FIXTURE_AS_OF + 100, dollars: 1_000_000 }],
        uncapped: false,
        debt: null,
        leverage: 1
      }
    ],
    programmes: [
      {
        id: 'u-prog-1',
        label: 'Added programme',
        pool: 'u-pool-1',
        reach: 'affordable',
        instrument: { kind: 'grant', share: 0.1 },
        from: FIXTURE_AS_OF + 100,
        to: null,
        minHomes: 2,
        tiers: { ...TIERS }
      }
    ],
    terms: {}
  };
}

/** Every limit reached: 12 pools of 12 yearly inflows, 24 programmes, 24 scale entries, five terms. */
export function maxFunding(): FinanceLevers {
  const label = 'x'.repeat(80);
  const pools: Pool[] = Array.from({ length: 12 }, (_, n) => ({
    id: `u-pool-${n + 1}`,
    kind: 'generalRevenue',
    label,
    inflows: Array.from({ length: 12 }, (_, k) => ({
      kind: 'yearly' as const,
      from: FIXTURE_AS_OF + k * 30,
      to: null,
      dollarsPerYear: 1_000_000 + k
    })),
    uncapped: false,
    debt: null,
    leverage: 1
  }));
  const programmes: Programme[] = Array.from({ length: 24 }, (_, n) => ({
    id: `u-prog-${n + 1}`,
    label,
    pool: `u-pool-${(n % 12) + 1}`,
    reach: 'affordable',
    instrument: { kind: 'grant', share: 0.05 },
    from: FIXTURE_AS_OF,
    to: null,
    minHomes: 2,
    tiers: { ...TIERS }
  }));
  const baseline = ['city-a', 'city-b', 'federal', 'state'];
  const baselineScale = baseline.flatMap((p) =>
    Array.from({ length: 6 }, (_, k) => ({
      pool: p,
      from: FIXTURE_AS_OF + 100 * (k + 1),
      scale: 1.5
    }))
  );
  const terms: Partial<Record<TermKey, number>> = {
    constructionRate: 0.07,
    constructionYears: 2,
    requiredReturn: 0.08,
    guaranteeRateCut: 0.01,
    lossOnExit: 0.5
  };
  return { baselineScale, pools, programmes, terms };
}
