import type { CompositionDraws, OccupiedComposition, RoofAccent } from './composition-types';
import { MAX_COMPOSITION_PARTS, MAX_COMPOSITION_VERTICES, MAX_ROOF_ACCENTS } from './constants';
import { insideDomain } from './domain';
import { floorTop } from './massing';
import { canonicalRing, inset, signedArea } from './poly';
import type { Site } from './site';

export function roofAccents(
  site: Site,
  composition: OccupiedComposition,
  draws: CompositionDraws,
  parapetM: number
): RoofAccent[] {
  if (!draws.capEnabled || parapetM <= 0) return [];
  const all = composition.bands.flatMap((b) => b.regions);
  let vertices = all.reduce((n, r) => n + r.length, 0);
  if (all.length > MAX_COMPOSITION_PARTS || vertices >= MAX_COMPOSITION_VERTICES) return [];
  const roofs = composition.bands
    .filter((b) => b.firstFloor + b.floors - 1 === composition.stories)
    .flatMap((b) => b.regions);
  const caps: RoofAccent[] = [];
  const baseM = floorTop(composition.typology, composition.stories);
  for (const roof of roofs) {
    for (const ring of inset([roof], 0.2)) {
      if (caps.length >= MAX_ROOF_ACCENTS) return caps;
      if (
        signedArea(ring) < 1 ||
        vertices + ring.length > MAX_COMPOSITION_VERTICES ||
        !insideDomain([ring], site.domain)
      )
        continue;
      vertices += ring.length;
      caps.push({
        ring: canonicalRing(ring),
        baseM,
        topM: baseM + parapetM,
        tone: draws.tone === 0 ? 2 : 0
      });
    }
  }
  return caps;
}
