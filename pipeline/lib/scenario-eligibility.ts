import type { ParcelRecord } from '../../src/lib/data/parcel';

/** The chunk record's `landUse` of a parcel with no land-use (LUDB) row (20_landuse.sql). */
export const NO_LAND_USE = 'NONE';

/**
 * Scenario eligibility (T11 flags bit 5; the T13 panel's `hostable_base`): the chunk record's
 * `eligible`, or, for a parcel with no land-use row, assessor units > 0 (T14
 * sd.landuse.none-with-units, coordinator ruling). `existingUnits` is the post-rule roll value:
 * the latest roll year's for T11, each roll year's own for the panel. OPENSPACE stays excluded
 * and the chunk record (and so the editor) is unchanged. Pure.
 */
export function scenarioEligible(
  rec: Pick<ParcelRecord, 'eligible' | 'landUse'>,
  existingUnits: number
): boolean {
  return rec.eligible || (rec.landUse === NO_LAND_USE && existingUnits > 0);
}
