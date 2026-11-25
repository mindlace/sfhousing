// The car-ownership model's types. Pure; relative imports only (the pipeline imports this folder).
import type { Provenance } from '../../timelapse/types';

export const CAR_LEVELS = 4; // households with 0, 1, 2, 3+ cars

/**
 * The four mixes a new home's household type is drawn from. The movers' refill (the zone's own
 * type mix times its PUMA's `moves.inRatio`) takes the draw index right after them:
 * `MIXES.length`.
 */
export const MIXES = ['market', 'veryLow', 'low', 'moderate'] as const;
export type Mix = (typeof MIXES)[number];

/** Draw index of the movers' refill, the one after the four `MIXES`. */
export const IN_MIX_DRAW = MIXES.length;

/**
 * Draw purposes of the car system; never reuse P's 1-12 or the retired 17-23. `OCCUPY` rounds the
 * homes completed (index the mix) and lost (index `MIXES.length`) in a zone-month to households.
 */
export const CAR_P = {
  OUT: 24,
  OUT_CARS: 25,
  IN_TYPES: 26,
  CHOOSE: 27,
  EMPTY: 28,
  OCCUPY: 29
} as const;

/** Lower edges of each band. */
export interface TypeBands {
  size: number[];
  workers: number[];
  income: number[];
}

export interface CarModel {
  schema: 1;
  bands: TypeBands; // types T = |size| x |workers| x |income| x 2 (own, rent), at most 255
  choice: {
    asc: number[]; // 3: levels 1, 2, 3+ against 0
    household: number[]; // T x 3: each type's household utility per level
    location: { density: number[]; access: number[] }; // 3 each
    terms: { name: string; coef: number[] }[]; // the fitted coefficients, for the report
    provenance: Provenance;
  };
  threePlusMean: number; // cars per 3+ household, PUMS
  moves: {
    perMonth: number[]; // T
    /**
     * PUMAs x T: a type's share of the PUMA's recent movers over its share of all the PUMA's
     * households (0 where it has none). A zone's movers are replaced by its own current type mix
     * times this, renormalised, so the zone keeps its composition while carrying PUMS's
     * mover-versus-stayer difference.
     */
    inRatio: number[][];
    provenance: Provenance;
  };
  newHomes: {
    mix: Record<Mix, number[]>; // T shares each, sum 1
    affordableTiers: { veryLow: number; low: number; moderate: number }; // sum 1
    provenance: Provenance;
  };
  parking: {
    supplyOverUse: number;
    /** Per space, by type; a type may be null, and null overall is the link off. */
    costPerSpace: {
      surface: number | null;
      podium: number | null;
      belowGrade: number | null;
    } | null;
    dollarsYear: number | null; // one year for every entry; one untyped cited cost may fill all three
    provenance: Provenance[];
  };
  refreshMonths: number; // 12
}

export const MAX_TYPES = 255;

/** Number of household types: size x workers x income bands, own and rent. */
export function typeCount(b: TypeBands): number {
  return b.size.length * b.workers.length * b.income.length * 2;
}

/** Band of x: the count of edges <= x, minus one, clamped to the bands. */
function bandOf(edges: readonly number[], x: number): number {
  let n = 0;
  for (let i = 0; i < edges.length; i++) if (edges[i] <= x) n++;
  return n === 0 ? 0 : n - 1;
}

/** Type index: size, then workers, then income, then tenure (owner 0, renter 1), row-major. */
export function typeIndex(
  b: TypeBands,
  size: number,
  workers: number,
  income: number,
  owner: boolean
): number {
  const s = bandOf(b.size, size);
  const w = bandOf(b.workers, workers);
  const i = bandOf(b.income, income);
  return ((s * b.workers.length + w) * b.income.length + i) * 2 + (owner ? 0 : 1);
}
