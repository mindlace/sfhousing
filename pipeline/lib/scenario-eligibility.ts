import type { ParcelRecord } from '../../src/lib/data/parcel';

/** The chunk record's `landUse` of a parcel with no land-use (LUDB) row (20_landuse.sql). */
export const NO_LAND_USE = 'NONE';

/**
 * Scenario eligibility (T11 flags bit 5; the T13 panel's `hostable_base`): the chunk record's
 * `eligible`, or, for a parcel with no land-use row, assessor units > 0 (T14
 * sd.landuse.none-with-units, coordinator ruling). `existingUnits` is the post-rule roll value:
 * the latest roll year's for T11, each roll year's own for the panel. OPENSPACE stays excluded
 * and the chunk record (and so the editor) is unchanged. A lot wholly in the water is never
 * eligible, whatever its roll says (it keeps its homes but takes no yield). Freeway land
 * (`freewayLand` true: a parcel of the curated catalog, `pipeline/lib/lesscars/freeway-land.ts`)
 * is never eligible either: it is unbuildable while its freeway stands. T11 passes the flag; the
 * T13 panel does not (calibration describes the past market). Pure.
 */
export function scenarioEligible(
  rec: Pick<ParcelRecord, 'eligible' | 'landUse' | 'underwater'>,
  existingUnits: number,
  freewayLand = false
): boolean {
  if (rec.underwater || freewayLand) return false;
  return rec.eligible || (rec.landUse === NO_LAND_USE && existingUnits > 0);
}
