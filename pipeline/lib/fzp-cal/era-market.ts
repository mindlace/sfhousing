/**
 * Each record's own-year market for the choice-spread fit (building-choice plan, Task 13a; owner
 * ruling 2026-11-26): a recorded project is fitted at the cost and value of the year it was first
 * recorded, the shipped step's anchors scaled by a value index and a cost index relative to the
 * shipped step's year. Only the fit reads these: the shipped simulation keeps today's one step,
 * and no index value is written to the dataset.
 */
import type { Sourced } from '../../../src/lib/sim/finance/evidence';
import type { PriceStep } from '../../../src/lib/sim/choice/types';
import type { Provenance } from '../../../src/lib/timelapse/types';
import { DGS_CCCI_URL } from '../../sources/dgs';

/**
 * Value by year: FHFA's annual House Price Index for San Francisco County (FIPS 06075),
 * all-transactions, not seasonally adjusted, base 100 when first recorded. Tier 1 (official
 * aggregate); its use for new apartments' value is an inference.
 */
export const ERA_VALUE_INDEX: Sourced<Record<number, number>> = {
  value: {
    2007: 1734.37,
    2008: 1637.48,
    2009: 1496.69,
    2010: 1464.61,
    2011: 1392.55,
    2012: 1437.42,
    2013: 1596.17,
    2014: 1849.29,
    2015: 2049.14,
    2016: 2264.18,
    2017: 2368.92,
    2018: 2542.29,
    2019: 2579.87,
    2020: 2409.82,
    2021: 2412.05,
    2022: 2685.14,
    2023: 2657.63,
    2024: 2726.13,
    2025: 2739.65
  },
  provenance: {
    tier: 1,
    label: 'FHFA House Price Index, San Francisco County, annual',
    sources: [
      {
        label: 'FHFA, "HPI for Counties (All-Transactions Index)", annual, last updated 2026-03-31',
        url: 'https://www.fhfa.gov/hpi/download/annual/hpi_at_county.csv'
      }
    ],
    method:
      'Column F (HPI, base 100 when first recorded) for San Francisco, 06075, 2007 to 2025, ' +
      'read 2026-11-26. A U.S. government work (public domain). Used as the value of new homes by ' +
      'year (an inference: the index follows homes sold with Fannie Mae and Freddie Mac loans, not ' +
      'new apartments). The assessor roll was tried first and rejected: the median value per ' +
      'square foot of new buildings of 5 or more homes on their first roll after completion rises ' +
      'about fourfold from roll year 2015 to 2025, on 5 to 37 buildings a year, which no sales ' +
      'series shows.',
    window: ['2007-01-01', '2025-12-31']
  }
};

/**
 * Cost by year: the DGS California Construction Cost Index (built from ENR's Building Cost Index
 * for San Francisco and Los Angeles), the mean of its monthly values per year. Tier 1 (official
 * aggregate). Its values are not in the code: the page states no terms of use, so `fetch` stores
 * it in the raw cache, pinned in the lock (pipeline/sources/dgs.ts), and the calibration step
 * passes its yearly means to `eraRatios`. Never written to the dataset.
 */
export const ERA_COST_PROVENANCE: Provenance = {
  tier: 1,
  label: 'DGS California Construction Cost Index, annual mean',
  sources: [
    {
      label:
        'California Department of General Services, "DGS California Construction Cost Index CCCI"',
      url: DGS_CCCI_URL
    }
  ],
  method:
    'The mean of the monthly CCCI values per calendar year (the current year over its months so ' +
    'far), from the locked dgs-ccci source. DGS computes the CCCI as the average of ENR Building ' +
    'Cost Index values for San Francisco and Los Angeles. The page states no terms of use, so it ' +
    'is used for the fit only and neither committed nor written to the dataset.'
};

/**
 * The index at `year`: its own value, or, for a year it lacks, its nearest covered year's (an
 * earlier one on a tie). An empty index is refused.
 */
function at(index: Record<number, number>, year: number): number {
  const years = Object.keys(index).map(Number);
  if (years.length === 0) throw new RangeError('era-market: empty index');
  if (year in index) return index[year];
  let best = years[0];
  for (const y of years) {
    const d = Math.abs(y - year) - Math.abs(best - year);
    if (d < 0 || (d === 0 && y < best)) best = y;
  }
  return index[best];
}

/**
 * Value and cost at `year` as multiples of their values at `shipYear`: the value from
 * ERA_VALUE_INDEX, the cost from `cost` (the locked CCCI's yearly means, `readCostIndex`).
 */
export function eraRatios(
  year: number,
  shipYear: number,
  cost: Record<number, number>
): { value: number; cost: number } {
  return {
    value: at(ERA_VALUE_INDEX.value, year) / at(ERA_VALUE_INDEX.value, shipYear),
    cost: at(cost, year) / at(cost, shipYear)
  };
}

/**
 * `p` at another year's market: every anchor's cost per home times `r.cost` and value per home
 * times `r.value`. The carrying cost follows the cost (it is a share of it); the cost ratio
 * above the top anchor is kept. At ratios of 1 it is `p` itself.
 */
export function eraPrices(p: PriceStep, r: { value: number; cost: number }): PriceStep {
  if (r.value === 1 && r.cost === 1) return p;
  const anchors = Object.fromEntries(
    Object.entries(p.anchors).map(([id, a]) => [
      id,
      { ...a, costPerHome: a.costPerHome * r.cost, valuePerHome: a.valuePerHome * r.value }
    ])
  ) as PriceStep['anchors'];
  return { ...p, anchors };
}
