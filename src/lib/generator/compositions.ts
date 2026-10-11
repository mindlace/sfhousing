import { FillRule, intersectD, type PathsD } from 'clipper2-ts';
import { bandsSupported, occupiedArea, retainsCapacity, floorSlices } from './bands';
import type { CompositionDraws, FloorBand, OccupiedComposition } from './composition-types';
import {
  MAX_COMPOSITION_PARTS,
  MAX_COMPOSITION_VERTICES,
  MAX_FAMILY_ATTEMPTS,
  MIN_PIECE_M2,
  FTF_M,
  rulesFor
} from './constants';
import { domainArea, fitSimpleRegions, insideDomain } from './domain';
import { massTypology } from './massing';
import { canonicalRing, inset, orientedRect, project, signedArea } from './poly';
import type { Site } from './site';
import type { ReplacementTypology } from './types';
import type { VarietyDraws } from './variety';

export function referenceComposition(
  site: Site,
  typology: ReplacementTypology,
  stories: number,
  draws: VarietyDraws
): OccupiedComposition | null {
  const mass = massTypology(site, typology, stories, draws);
  if (!mass) return null;
  const bands: FloorBand[] = [];
  for (const part of mass.parts) {
    const firstFloor =
      part.baseM === 0
        ? 1
        : Math.round((part.baseM - rulesFor(mass.typology).groundFtfM) / FTF_M) + 2;
    let band = bands.find((b) => b.firstFloor === firstFloor && b.floors === part.floors);
    if (!band) {
      band = { firstFloor, floors: part.floors, regions: [] };
      bands.push(band);
    }
    band.regions.push(canonicalRing(part.ring));
  }
  return { family: 'simple', typology: mass.typology, stories: mass.stories, bands };
}

export function validComposition(
  site: Site,
  candidate: OccupiedComposition,
  reference: OccupiedComposition
): boolean {
  const { bands } = candidate;
  if (
    candidate.stories !== reference.stories ||
    candidate.typology !== reference.typology ||
    !bandsSupported(bands)
  )
    return false;
  if (Math.max(...bands.map((b) => b.firstFloor + b.floors - 1)) !== candidate.stories)
    return false;
  const regions = bands.flatMap((b) => b.regions);
  if (
    regions.length > MAX_COMPOSITION_PARTS ||
    regions.reduce((n, r) => n + r.length, 0) > MAX_COMPOSITION_VERTICES
  )
    return false;
  if (
    regions.some(
      (r) =>
        signedArea(r) < MIN_PIECE_M2 || !inset([r], 1.5).length || !insideDomain([r], site.domain)
    )
  )
    return false;
  for (const slice of floorSlices(bands)) {
    const active = bands
      .filter((b) => b.firstFloor <= slice.firstFloor && b.firstFloor + b.floors > slice.firstFloor)
      .flatMap((b) => b.regions);
    if (active.reduce((a, r) => a + signedArea(r), 0) - domainArea(slice.regions) > 0.001)
      return false;
  }
  return retainsCapacity(candidate, reference);
}

/** Clip a roof slab in the parcel's long-axis frame; clipping preserves notches and exclusions. */
function cutTop(site: Site, regions: PathsD, divided: boolean, depth: number): PathsD {
  const pu = project(regions, site.c, site.u);
  const pv = project(regions, site.c, site.v);
  const rect = (a: number, b: number) =>
    orientedRect(site.c, site.u, site.v, a, b, pv.min - 1, pv.max + 1);
  const middle = (pu.min + pu.max) / 2;
  const clips = divided
    ? [rect(pu.min - 1, middle - depth / 2), rect(middle + depth / 2, pu.max + 1)]
    : [rect(pu.min - 1, pu.max - depth)];
  return clips.flatMap((clip) =>
    fitSimpleRegions(intersectD(regions, [clip], FillRule.NonZero, 4), site)
  );
}

function roofRecipe(
  site: Site,
  reference: OccupiedComposition,
  draws: CompositionDraws,
  divided: boolean,
  scale: number
): OccupiedComposition {
  const topFloors = reference.typology === 'midrise' ? draws.shoulderFloors : 1;
  const firstFloor = reference.stories - topFloors + 1;
  const lower = reference.bands.flatMap((b) => {
    const floors = Math.min(b.floors, firstFloor - b.firstFloor);
    return floors > 0 ? [{ ...b, floors }] : [];
  });
  const top = reference.bands
    .filter((b) => b.firstFloor <= firstFloor && b.firstFloor + b.floors > firstFloor)
    .flatMap((b) => b.regions);
  const regions = cutTop(site, top, divided, draws.setbackM * scale);
  return {
    ...reference,
    family: divided ? 'divided' : 'terrace',
    bands: [...lower, { firstFloor, floors: topFloors, regions }]
  };
}

export function compositionCandidates(
  site: Site,
  reference: OccupiedComposition,
  draws: CompositionDraws
): OccupiedComposition[] {
  const candidates: OccupiedComposition[] = [];
  const compatible =
    ['walkup', 'podium', 'midrise'].includes(reference.typology) && reference.stories >= 5;
  for (const family of draws.familyOrder) {
    if (family === 'simple') {
      candidates.push(reference);
      continue;
    }
    if (!compatible || (family !== 'terrace' && family !== 'divided')) continue;
    for (let attempt = 0; attempt < MAX_FAMILY_ATTEMPTS; attempt++) {
      const candidate = roofRecipe(site, reference, draws, family === 'divided', 1 - attempt * 0.2);
      if (occupiedArea(candidate.bands) > 0 && validComposition(site, candidate, reference)) {
        candidates.push(candidate);
        break;
      }
    }
  }
  if (!candidates.some((c) => c.family === 'simple')) candidates.push(reference);
  return candidates;
}
