/**
 * Test helper: the mini calibration with a market, `affordableRoutes` and a baseline funding of
 * the mini finance's pools, made to pass `parseCalibration`. Shared by the host specs.
 */
import { log } from '$lib/timelapse/math';
import type { Calibration, Provenance } from '$lib/timelapse/types';
import miniCalibrationJson from '../fixtures/mini-calibration.json';
import { miniCalibrationWithRoutes, miniFinance } from '../fixtures/mini-finance';
import { miniFunding, miniMarket } from '../fixtures/mini-market';

const SOURCE = { label: 'test fixture', url: 'https://example.org/test-fixture' };

/** Every provenance without a source gets one (parseCalibration wants at least one). */
export function sourced<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sourced) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, sourced(x)])
    );
    if ('tier' in o && Array.isArray(o.sources) && o.sources.length === 0) o.sources = [SOURCE];
    return o as T;
  }
  return v;
}

/**
 * The mini calibration with a market, `affordableRoutes` and a baseline funding of the mini
 * finance's three pools. Made to pass `parseCalibration`: the baseline keeps only the grant
 * programmes, `market.today`'s log odds are ln(observed ÷ implied), and every provenance names a
 * source.
 */
export function fundedCalibration(): Calibration {
  const f = miniFinance();
  const market = sourced(miniMarket());
  market.today.all = log(market.today.observed.all / market.today.implied);
  market.today.private = log(market.today.observed.private / market.today.implied);
  const prov: Provenance = {
    tier: 4,
    label: 'test fixture',
    sources: [SOURCE],
    method: 'invented for tests'
  };
  return {
    ...(structuredClone(miniCalibrationJson) as unknown as Calibration),
    market,
    affordableRoutes: sourced(miniCalibrationWithRoutes().affordableRoutes),
    baselineFunding: {
      pools: f.pools,
      programmes: f.programmes.filter((g) => g.instrument.kind === 'grant'),
      provenance: [...f.pools.map(() => prov), prov],
      check: sourced(miniFunding().check)
    }
  };
}
