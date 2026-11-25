// The car model's start population: household type bands, the block-group margins the PUMS seed
// is reweighted to (ACS 5-year tables, docs/dev/cars-data.md), and the IPF settings. Every
// number here is a band edge, a Census cell map or a solver setting, not a fitted parameter.
import type { TypeBands } from '../../../src/lib/sim/cars';

/**
 * Household type bands (lower edges): size 1, 2, 3, 4+; workers 0, 1, 2+; income in four bands at
 * the weighted PUMS quartiles of the latest release (`typeBandsOf`). Owner or renter doubles it:
 * 96 types. Builder's call (spec "Households"), kept coarse enough that every PUMA fills each
 * margin class the block groups control.
 */
export const TYPE_BANDS = {
  size: [1, 2, 3, 4],
  workers: [0, 1, 2],
  incomeQuantiles: [0.25, 0.5, 0.75]
} as const;

/** PUMS `TEN`: 1 owned with a mortgage, 2 owned free and clear; 3 rented, 4 no cash rent. */
export const isOwner = (ten: number) => ten === 1 || ten === 2;

/** B19001 bracket lower edges (dollars of the release's final year), 16 brackets. */
export const B19001_EDGES = [
  0, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 60_000, 75_000,
  100_000, 125_000, 150_000, 200_000
] as const;

/**
 * One block-group margin: `size` classes, the ACS cell feeding each class (cells sharing a class
 * add), and the total cell. Classes of the two tenure tables are owner 0-3, renter 4-7.
 */
export interface Margin {
  table: string;
  size: number;
  total: string;
  cells: Record<string, number>;
}

const cells = (table: string, first: number, classes: number[]) =>
  Object.fromEntries(classes.map((c, i) => [`${table}_${String(first + i).padStart(3, '0')}`, c]));

/**
 * The margins, in the order `pumsSeed` classes records: B25044 tenure by vehicles (0, 1, 2, 3+),
 * B25009 tenure by household size (1, 2, 3, 4+), B19001 household income (16 brackets). No
 * block-group table counts workers per household (B08202 is tract only; B08301 counts persons),
 * so workers come from the PUMA's PUMS records under these margins; B08301 is a cross-check.
 */
export const MARGINS: readonly Margin[] = [
  {
    table: 'B25044',
    size: 8,
    total: 'B25044_001',
    cells: { ...cells('B25044', 3, [0, 1, 2, 3, 3, 3]), ...cells('B25044', 10, [4, 5, 6, 7, 7, 7]) }
  },
  {
    table: 'B25009',
    size: 8,
    total: 'B25009_001',
    cells: {
      ...cells('B25009', 3, [0, 1, 2, 3, 3, 3, 3]),
      ...cells('B25009', 11, [4, 5, 6, 7, 7, 7, 7])
    }
  },
  {
    table: 'B19001',
    size: 16,
    total: 'B19001_001',
    cells: cells(
      'B19001',
      2,
      B19001_EDGES.map((_, i) => i)
    )
  }
];

/** B25002 occupancy: total homes and occupied homes. */
export const OCCUPANCY = { total: 'B25002_001', occupied: 'B25002_002' } as const;
/** B08301_001, workers 16 and over by residence: the workers cross-check. */
export const WORKERS_TOTAL = 'B08301_001';

/** IPF per block group: stop when every margin class is within `tol` (relative) or at maxIter. */
export const IPF = { maxIter: 200, tol: 1e-6 } as const;
/** A zone whose fit misses a margin class by more than this (relative) is reported. */
export const IPF_REPORT_ERR = 0.01;

/** The integerising rounding's fixed offset (the pipeline has no seed). */
export const ROUND_U = 0.5;

/** Weighted quantile of `x` (weights `w`) at p: the smallest x whose cumulative weight >= p. */
export function weightedQuantile(x: ArrayLike<number>, w: ArrayLike<number>, p: number): number {
  const order = Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i];
  let acc = 0;
  for (const i of order) {
    acc += w[i];
    if (acc >= p * total) return x[i];
  }
  return order.length ? x[order[order.length - 1]] : 0;
}

/** Type bands with the income edges at the weighted PUMS quartiles (whole dollars). */
export function typeBandsOf(rows: readonly { hincp_adj: number; wgtp: number }[]): TypeBands {
  const x = rows.map((r) => r.hincp_adj);
  const w = rows.map((r) => r.wgtp);
  return {
    size: [...TYPE_BANDS.size],
    workers: [...TYPE_BANDS.workers],
    income: [0, ...TYPE_BANDS.incomeQuantiles.map((p) => Math.round(weightedQuantile(x, w, p)))]
  };
}
