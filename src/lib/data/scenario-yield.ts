import { fnv1a32, generate } from '../generator';
import type { ParcelRecord } from './parcel';

/**
 * The density cap step of `scenarioYield`, on its uncapped gross: a set `cap` clips the gross
 * units, then gives 0 when `cap <= existingUnits` (I8's "fewer homes" rule applied after the
 * cap). `capScenarioYield(scenarioYield(rec, s, null), cap, rec.existingUnits)` equals
 * `scenarioYield(rec, s, cap)`, so a caller can generate once per story count and cap twice.
 */
export function capScenarioYield(gross: number, cap: number | null, existingUnits: number): number {
  if (cap === null) return gross;
  if (cap <= existingUnits) return 0;
  return Math.min(gross, cap);
}

/**
 * Gross units on the parcel after the project, for the FZP scenario yield table (spec §4.7).
 * Pure; shared by the pipeline and any later worker recompute.
 *
 * - `stories <= 0` gives 0 without generating.
 * - `b = generate(rec, { maxStories: stories }, fnv1a32(rec.id), 'max')` (I14 seed).
 * - `null` and ADU outcomes (`replacesExisting === false`) give 0: the yield table holds
 *   replacement typologies only.
 * - A set `cap` clips the gross units, then gives 0 when `cap <= rec.existingUnits`
 *   (I8's "fewer homes" rule applied after the cap; `capScenarioYield`).
 *
 * No numeric parameters of its own: the story count and cap are supplied by the caller
 * (tier 3 stories rule and tier 1 cap, per spec §4.7).
 */
export function scenarioYield(rec: ParcelRecord, stories: number, cap: number | null): number {
  if (stories <= 0) return 0;
  const b = generate(rec, { maxStories: stories }, fnv1a32(rec.id), 'max');
  if (b === null || !b.replacesExisting) return 0;
  return capScenarioYield(b.units, cap, rec.existingUnits);
}
