import { FillRule, unionD, type PathsD } from 'clipper2-ts';
import { signedArea } from './poly';
import { EFFICIENCY, rulesFor } from './constants';
import { domainArea, insideDomain } from './domain';
import type { FloorBand, OccupiedComposition } from './composition-types';
import type { TypologyId } from './types';

function disjointRegions(regions: PathsD): boolean {
  if (regions.length <= 1) return true;
  if (regions.some((r) => signedArea(r) < 0)) return false;
  const bounds = regions.map((r) => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of r) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1 };
  });
  return bounds.every((a, i) =>
    bounds.slice(i + 1).every((b) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0)
  );
}
function consecutive(bands: readonly FloorBand[]): boolean {
  return bands.every(
    (b, i) =>
      disjointRegions(b.regions) &&
      (!i || b.firstFloor === bands[i - 1].firstFloor + bands[i - 1].floors)
  );
}

/** Split only at band boundaries, avoiding per-floor clipping on tall buildings. */
export function floorSlices(bands: readonly FloorBand[]): FloorBand[] {
  if (consecutive(bands)) return [...bands];
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
      regions: !disjointRegions(regions) ? unionD(regions, [], FillRule.NonZero, 8) : regions
    };
  });
}
export function occupiedArea(bands: readonly FloorBand[]): number {
  if (consecutive(bands))
    return bands.reduce((sum, b) => sum + domainArea(b.regions) * b.floors, 0);
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
