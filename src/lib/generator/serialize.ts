import type { PathD } from 'clipper2-ts';
import type { ParcelRecord } from '../data/parcel';
import type { OccupiedComposition, RoofAccent } from './composition-types';
import { rulesFor } from './constants';
import { occupiedArea, floorSlices } from './bands';
import { insideDomain } from './domain';
import { fromLngLat, toLngLat } from './geo';
import { canonicalRing, inset, signedArea } from './poly';
import type { Site } from './site';
import { floorTop } from './massing';
import type { LocalPart } from './generate';
import type { GeneratedBuilding } from './types';

/** An occupied fragment may never disappear while its area remains in the total. */
export function serializeComposition(
  parcel: ParcelRecord,
  site: Site,
  composition: OccupiedComposition,
  caps: RoofAccent[],
  tone: 0 | 1 | 2
): { local: LocalPart[]; parts: GeneratedBuilding['parts']; area: number } | null {
  let repairDistance = 0.02;
  for (let repair = 0; repair <= 2; repair++) {
    const local: LocalPart[] = [],
      parts: GeneratedBuilding['parts'] = [];
    const bands = composition.bands.map((b) => ({ ...b, regions: [] as PathD[] }));
    let failed = false;
    const append = (
      ring: PathD,
      baseM: number,
      topM: number,
      role: 'occupied' | 'roof',
      partTone: 0 | 1 | 2
    ): PathD | null => {
      const repaired = repair ? inset([ring], repair * repairDistance, 4) : [ring];
      if (repaired.length !== 1) return null;
      const raw = toLngLat(
        canonicalRing(repaired[0]).map((p) => [p.x, p.y]),
        parcel.labelPoint
      );
      const ll = raw.filter((p, i) => {
        const prev = raw[(i + raw.length - 1) % raw.length];
        return p[0] !== prev[0] || p[1] !== prev[1];
      });
      if (ll.length < 3) return null;
      const xy = fromLngLat(ll, parcel.labelPoint);
      const path = xy.map(([x, y]) => ({ x, y }));
      if (
        signedArea(path) < (role === 'occupied' ? 10 : 1) ||
        !insideDomain([path], site.originalDomain)
      )
        return null;
      local.push({
        ring: xy,
        baseM: Math.round(baseM * 100) / 100,
        topM: Math.round(topM * 100) / 100,
        role,
        tone: partTone
      });
      parts.push({
        footprint: ll,
        baseM: local.at(-1)!.baseM,
        topM: local.at(-1)!.topM,
        role,
        tone: partTone
      });
      return path;
    };
    for (let i = 0; i < bands.length; i++) {
      const b = composition.bands[i];
      for (const ring of b.regions) {
        const path = append(
          ring,
          b.firstFloor === 1 ? 0 : floorTop(composition.typology, b.firstFloor - 1),
          floorTop(composition.typology, b.firstFloor + b.floors - 1),
          'occupied',
          tone
        );
        if (!path) {
          failed = true;
          break;
        }
        bands[i].regions.push(path);
      }
    }
    if (failed) continue;
    if (composition.typology !== 'adu') {
      const base = bands.filter((b) => b.firstFloor === 1).flatMap((b) => b.regions);
      const excess =
        base.reduce((n, r) => n + signedArea(r), 0) -
        rulesFor(composition.typology).coverage * site.A;
      if (excess > 0.25) {
        const perimeter = base.reduce(
          (n, r) =>
            n +
            r.reduce(
              (a, p, i) =>
                a + Math.hypot(p.x - r[(i + 1) % r.length].x, p.y - r[(i + 1) % r.length].y),
              0
            ),
          0
        );
        repairDistance = Math.min(0.02, excess / perimeter + 0.001);
        continue;
      }
    }
    const slices = floorSlices(bands);
    for (let i = 1; i < slices.length; i++)
      if (!insideDomain(slices[i].regions, inset(slices[i - 1].regions, -0.02))) failed = true;
    if (failed) continue;
    for (const cap of caps) {
      const support = bands
        .filter((b) => b.firstFloor + b.floors - 1 === composition.stories)
        .flatMap((b) => b.regions);
      const before = local.length;
      const path = append(cap.ring, cap.baseM, cap.topM, 'roof', cap.tone);
      if (path && !insideDomain([path], inset(support, -0.02))) {
        local.splice(before);
        parts.splice(before);
      }
    }
    return { local, parts, area: occupiedArea(bands) };
  }
  return null;
}
