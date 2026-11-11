// The bench city's public-money fixtures (finance-engine spec 4.17). Test values, not data.
// Browser-safe: no `node:` imports.
import type { Calibration } from '$lib/timelapse/types';

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
      sources: [],
      method:
        'The pathway shares of 53 projects of 10 homes or more proposing at least 95% ' +
        'affordable homes, used as test values on the synthetic bench city (tier 4).'
    }
  };
}
