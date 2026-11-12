/** Funding fixtures for the Funding tab and Results money rows specs. */
import { fixtureMarketCalibration } from '$lib/fzp/fixtures/market';
import { FIX_ASOF } from '$lib/fzp/fixtures/cards';
import { dayOf } from '$lib/sim/scenario/dates';
import type { FinanceLevers } from '$lib/sim/levers/types';
import type { Calibration, Day, Pool, PoolKind, Programme, Provenance } from '$lib/timelapse/types';
import { DEFAULT_POLICY, type SimPolicy } from '../policy';

export const FUND_ASOF: Day = FIX_ASOF;

const TIERS = { veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 };

const prov = (label: string): Provenance => ({
  tier: 1,
  label,
  sources: [{ label: 'Test source', url: 'https://example.org/funding' }],
  method: 'Fixture value'
});

const grant = (id: string, pool: string, share: number, from: Day): Programme => ({
  id,
  label: `${id} grant`,
  pool,
  reach: 'affordable',
  instrument: { kind: 'grant', share },
  from,
  to: null,
  minHomes: 20,
  tiers: { ...TIERS }
});

const basePool = (id: string, kind: PoolKind): Pool => ({
  id,
  kind,
  label: id,
  inflows:
    kind === 'federal'
      ? []
      : [{ kind: 'yearly', from: FUND_ASOF, to: null, dollarsPerYear: 100_000_000 }],
  uncapped: kind === 'federal',
  debt: null,
  leverage: 1
});

/** The market fixture calibration with a baseline of City, state and federal affordable grants. */
export function fundingCalibration(): Calibration {
  const cal = fixtureMarketCalibration();
  cal.baselineFunding = {
    pools: [
      basePool('city-tax', 'dedicatedTax'),
      basePool('city-gf', 'generalRevenue'),
      basePool('state', 'state'),
      basePool('federal', 'federal')
    ],
    programmes: [
      grant('city-tax-grant', 'city-tax', 0.2, FUND_ASOF),
      grant('city-gf-grant', 'city-gf', 0.148251, FUND_ASOF),
      grant('state-grant', 'state', 0.137419, FUND_ASOF),
      grant('federal-grant', 'federal', 0.51433, FUND_ASOF)
    ],
    provenance: [
      prov('City dedicated tax'),
      prov('City general revenue'),
      prov('State'),
      prov('Federal'),
      prov('Tiers and minimum homes')
    ],
    check: {
      impliedHomesPerYear: 780,
      observedHomesPerYear: 800,
      provenance: prov('Implied against observed homes per year')
    }
  };
  return cal;
}

/** The default policy with some funding levers set. */
export function policyWith(funding: Partial<FinanceLevers>): SimPolicy {
  const base = structuredClone(DEFAULT_POLICY);
  return { ...base, funding: { ...base.funding, ...funding } };
}

const BOND_DAY = dayOf(2028, 7, 1);

/** One added City bond: $300,000,000 on 1 July 2028 at 6% over 20 years, one grant programme. */
export const BOND_POLICY: SimPolicy = policyWith({
  pools: [
    {
      id: 'u-pool-1',
      kind: 'goBond',
      label: 'City bond, 2028',
      inflows: [{ kind: 'once', day: BOND_DAY, dollars: 300_000_000 }],
      uncapped: false,
      debt: { rate: 0.06, termYears: 20 },
      leverage: 1
    }
  ],
  programmes: [grant('u-prog-1', 'u-pool-1', 0.35, BOND_DAY)]
});

/** A market-terms policy: the guarantee rate cut typed. */
export const TERM_POLICY: SimPolicy = policyWith({ terms: { guaranteeRateCut: 0.005 } });
