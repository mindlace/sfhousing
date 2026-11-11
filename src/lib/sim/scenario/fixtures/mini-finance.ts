// Test values for public money on the mini city (finance-engine spec section 6, "Fixtures"). Every
// number here is a tier 4 test value, not data. Browser-safe: no `node:` imports.
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
import { parseCalibration } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';
import type { Calibration, Provenance } from '$lib/timelapse/types';
import type { SimInput } from '../types';
import miniCalibrationJson from './mini-calibration.json';
import { MINI_AS_OF } from './mini-projects';

type Finance = NonNullable<SimInput['finance']>;

const provenance: Provenance = {
  tier: 4,
  label: 'test fixture',
  sources: [],
  method: 'invented for tests'
};

const TIERS = { veryLow: 0.4, low: 0.4, moderate: 0.2, aboveModerate: 0 };

/**
 * Two capped pools (`m-city`, yearly 20,000,000 from `asOf`; `m-bank`, a `bank` pool with one
 * 5,000,000 inflow on `asOf + 400` and leverage 0.8), one uncapped `federal` pool, and four
 * programmes: a certain affordable grant stack (`m-city` 0.35 and `federal` 0.65, `minHomes` 2),
 * a market loan on `m-bank` and a market guarantee on `m-city`. `m-bank` is off from
 * `asOf + 2000` to `asOf + 2400`.
 */
export function miniFinance(asOf: Day = MINI_AS_OF): Finance {
  return {
    pools: [
      {
        id: 'm-city',
        kind: 'generalRevenue',
        label: 'Mini City',
        inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 20_000_000 }],
        uncapped: false,
        debt: null,
        leverage: 1
      },
      {
        id: 'm-bank',
        kind: 'bank',
        label: 'Mini Bank',
        inflows: [{ kind: 'once', day: asOf + 400, dollars: 5_000_000 }],
        uncapped: false,
        debt: null,
        leverage: 0.8
      },
      {
        id: 'federal',
        kind: 'federal',
        label: 'Federal tax credits',
        inflows: [],
        uncapped: true,
        debt: null,
        leverage: 1
      }
    ],
    programmes: [
      {
        id: 'm-city-grant',
        label: 'Mini City grant',
        pool: 'm-city',
        reach: 'affordable',
        instrument: { kind: 'grant', share: 0.35 },
        from: asOf,
        to: null,
        minHomes: 2,
        tiers: { ...TIERS }
      },
      {
        id: 'federal-grant',
        label: 'Federal grant',
        pool: 'federal',
        reach: 'affordable',
        instrument: { kind: 'grant', share: 0.65 },
        from: asOf,
        to: null,
        minHomes: 2,
        tiers: { ...TIERS }
      },
      {
        id: 'm-bank-loan',
        label: 'Mini Bank loan',
        pool: 'm-bank',
        reach: 'market',
        instrument: { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null },
        from: asOf,
        to: null,
        minHomes: 0,
        tiers: null
      },
      {
        id: 'm-city-guarantee',
        label: 'Mini City guarantee',
        pool: 'm-city',
        reach: 'market',
        instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 },
        from: asOf,
        to: null,
        minHomes: 0,
        tiers: null
      }
    ],
    off: [{ pool: 'm-bank', from: asOf + 2000, to: asOf + 2400 }],
    slope: 3,
    terms: resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01 })
  };
}

/** The mini calibration with tier 4 `affordableRoutes`. */
export function miniCalibrationWithRoutes(): Calibration {
  const cal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
  return {
    ...cal,
    affordableRoutes: { discretionary: 0.3, streamlined: 0.67, permitOnly: 0.03, provenance }
  };
}
