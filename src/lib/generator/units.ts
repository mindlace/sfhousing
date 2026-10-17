import { unitsFor } from './bands';
import type { GeneratedBuilding } from './types';

/** Allowed unit-count drift (10%, at least 1) before a massing counts as approximate. */
export function unitsTolerance(units: number): number {
  return Math.max(1, Math.round(0.1 * units));
}

/** The unit count the building's own massing supports. */
export function massedUnits(b: GeneratedBuilding): number {
  return unitsFor(b.typology, b.floorAreaM2);
}

/** True when the massing cannot carry the building's recorded unit count within tolerance. */
export function massingApproximate(b: GeneratedBuilding): boolean {
  return Math.abs(massedUnits(b) - b.units) > unitsTolerance(b.units);
}
