import { exp } from '../../timelapse/math';
import { CAR_LEVELS, type CarModel } from './types';

/** Zone covariates the choice reads; CarData satisfies it. */
export interface ZoneTerms {
  access: Float64Array;
  constant: Float64Array; // zones x 3
}

/**
 * Shares of a household of `type` in `zone` at `density` (households per hectare) over 0, 1, 2 and
 * 3+ cars: a softmax of the level utilities, level 0 the base.
 */
export function carShares(
  m: CarModel,
  z: ZoneTerms,
  zone: number,
  type: number,
  density: number,
  out: Float64Array
): void {
  const { asc, household, location } = m.choice;
  const access = z.access[zone];
  let total = 1;
  out[0] = 1;
  for (let k = 0; k < CAR_LEVELS - 1; k++) {
    const u =
      asc[k] +
      household[type * 3 + k] +
      location.density[k] * density +
      location.access[k] * access +
      z.constant[zone * 3 + k];
    const e = exp(u);
    out[k + 1] = e;
    total += e;
  }
  for (let k = 0; k < CAR_LEVELS; k++) out[k] /= total;
}

/** Mean cars per household; the 3+ level counts `threePlusMean`. */
export function meanCars(shares: ArrayLike<number>, threePlusMean: number): number {
  return shares[1] + 2 * shares[2] + threePlusMean * shares[3];
}

/** Households per hectare; zero area gives 0. */
export function densityOf(households: number, areaM2: number): number {
  return areaM2 > 0 ? (households * 10_000) / areaM2 : 0;
}
