import { FillRule, unionD, type PathsD } from 'clipper2-ts';
import { EFFICIENCY, rulesFor } from './constants';
import { domainArea, insideDomain } from './domain';
import type { FloorBand, OccupiedComposition } from './composition-types';
import type { TypologyId } from './types';

/** Split only at band boundaries, avoiding per-floor clipping on tall buildings. */
export function floorSlices(bands: readonly FloorBand[]): FloorBand[] {
  const edges = [...new Set(bands.flatMap((b) => [b.firstFloor, b.firstFloor + b.floors]))].sort(
    (a, b) => a - b
  );
  return edges.slice(0, -1).map((firstFloor, i) => {
    const active = bands.filter(
      (b) => b.firstFloor <= firstFloor && b.firstFloor + b.floors > firstFloor
    );
    const regions = active.flatMap((b) => b.regions);
    return {
      firstFloor,
      floors: edges[i + 1] - firstFloor,
      regions: regions.length > 1 ? unionD(regions, [], FillRule.NonZero, 4) : regions
    };
  });
}
export function occupiedArea(bands: readonly FloorBand[]): number {
  return floorSlices(bands).reduce((sum, b) => sum + domainArea(b.regions) * b.floors, 0);
}
export function bandsSupported(bands: readonly FloorBand[]): boolean {
  if (
    !bands.length ||
    bands.some(
      (b) =>
        !Number.isInteger(b.firstFloor) ||
        b.firstFloor < 1 ||
        !Number.isInteger(b.floors) ||
        b.floors < 1 ||
        !b.regions.length
    )
  )
    return false;
  const slices = floorSlices(bands);
  if (slices[0].firstFloor !== 1) return false;
  let below: PathsD | null = null;
  for (const slice of slices) {
    if (!slice.regions.length || (below && !insideDomain(slice.regions, below))) return false;
    below = slice.regions;
  }
  return true;
}
export function unitsFor(typology: TypologyId, floorAreaM2: number): number {
  const rules = rulesFor(typology);
  return Math.min(
    rules.maxUnits,
    Math.floor(((Math.round(floorAreaM2 * 10) / 10) * EFFICIENCY) / rules.avgUnitM2)
  );
}
export function retainsCapacity(
  candidate: OccupiedComposition,
  reference: OccupiedComposition
): boolean {
  const area = occupiedArea(candidate.bands);
  const ref = occupiedArea(reference.bands);
  return (
    area >= 0.9 * ref &&
    unitsFor(candidate.typology, area) >= Math.ceil(0.9 * unitsFor(reference.typology, ref))
  );
}
