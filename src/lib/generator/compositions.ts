import { FillRule, intersectD, type PathsD } from 'clipper2-ts';
import { bandsSupported, occupiedArea, retainsCapacity, floorSlices } from './bands';
import type {
  CompositionDraws,
  CompositionId,
  FloorBand,
  OccupiedComposition
} from './composition-types';
import {
  MAX_COMPOSITION_PARTS,
  MAX_COMPOSITION_VERTICES,
  MAX_FAMILY_ATTEMPTS,
  MIN_PIECE_M2,
  FTF_M,
  rulesFor,
  TOWER_PLATE_MAX_M2,
  TOWER_COVERAGE,
  MIN_TOWER_PLATE_M2,
  MIN_TOWER_CORE_INSET_M,
  TOWER_SEPARATION_M
} from './constants';
import { domainArea, fitSimpleRegions, insideDomain } from './domain';
import { massTypology } from './massing';
import { canonicalRing, inset, intersect, orientedRect, project, signedArea } from './poly';
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
    const ring = canonicalRing(part.ring);
    if (inset([ring], 1.5).length) band.regions.push(ring);
  }
  if (bands.some((b) => !b.regions.length)) return null;
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
  if (candidate.typology === 'tower') {
    for (const slice of floorSlices(bands).filter((b) => b.firstFloor >= 6)) {
      if (domainArea(slice.regions) > Math.min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE * site.A) + 0.01)
        return false;
      if (
        slice.regions.some(
          (r) => signedArea(r) < MIN_TOWER_PLATE_M2 || !inset([r], MIN_TOWER_CORE_INSET_M).length
        )
      )
        return false;
      for (let i = 0; i < slice.regions.length; i++)
        for (let j = i + 1; j < slice.regions.length; j++) {
          if (
            domainArea(
              intersectD(
                inset([slice.regions[i]], -TOWER_SEPARATION_M / 2 + 0.001, 4),
                inset([slice.regions[j]], -TOWER_SEPARATION_M / 2 + 0.001, 4),
                FillRule.NonZero,
                4
              )
            ) > 0
          )
            return false;
        }
    }
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
  return clips.flatMap((clip) => fitSimpleRegions(intersect(regions, [clip]), site));
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

function towerRecipe(
  site: Site,
  reference: OccupiedComposition,
  draws: CompositionDraws,
  family: CompositionId,
  attempt: number
): OccupiedComposition {
  const base = reference.bands.filter((b) => b.firstFloor === 1);
  const support = inset(
    base.flatMap((b) => b.regions),
    1
  );
  const target = Math.min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE * site.A);
  const pu = project(support, site.c, site.u);
  const pv = project(support, site.c, site.v);
  const centreU = (pu.min + pu.max) / 2;
  const centreV = (pv.min + pv.max) / 2;
  const fit = (area: number, aspect: number, offset: number) => {
    const depth = Math.sqrt(area * aspect),
      width = Math.sqrt(area / aspect);
    const rect = orientedRect(
      site.c,
      site.u,
      site.v,
      centreU + offset - depth / 2,
      centreU + offset + depth / 2,
      centreV - width / 2,
      centreV + width / 2
    );
    return fitSimpleRegions(intersect([rect], support), site);
  };
  if (family === 'paired') {
    const split = draws.splitFraction;
    const a = target * split,
      b = target - a;
    const aspect = 0.8 + attempt * 0.1;
    const da = Math.sqrt(a * aspect),
      db = Math.sqrt(b * aspect);
    const total = da + db + TOWER_SEPARATION_M;
    const left = fit(a, aspect, -total / 2 + da / 2);
    const right = fit(b, aspect, total / 2 - db / 2);
    return {
      ...reference,
      family,
      bands: [
        ...base,
        { firstFloor: 6, floors: reference.stories - 5, regions: [...left, ...right] }
      ]
    };
  }
  const aspect = 1.5 + attempt * 0.25;
  const depth = Math.sqrt(target * aspect);
  const offset =
    family === 'offset'
      ? draws.offsetSign * Math.max(0, (pu.max - pu.min - depth) / 2) * (1 - attempt * 0.2)
      : 0;
  const regions = fit(target, aspect, offset);
  if (family === 'shouldered') {
    const topFloors = draws.shoulderFloors;
    const top = fitSimpleRegions(inset(regions, draws.setbackM * (1 - attempt * 0.2)), site);
    return {
      ...reference,
      family,
      bands: [
        ...base,
        { firstFloor: 6, floors: reference.stories - 5 - topFloors, regions },
        { firstFloor: reference.stories - topFloors + 1, floors: topFloors, regions: top }
      ]
    };
  }
  return {
    ...reference,
    family,
    bands: [...base, { firstFloor: 6, floors: reference.stories - 5, regions }]
  };
}

export function* compositionOptions(
  site: Site,
  reference: OccupiedComposition,
  draws: CompositionDraws
): Generator<OccupiedComposition> {
  let simple = false;
  const compatible =
    ['walkup', 'podium', 'midrise'].includes(reference.typology) && reference.stories >= 5;
  for (const family of draws.familyOrder) {
    if (family === 'simple') {
      simple = true;
      yield reference;
      continue;
    }
    const tower =
      reference.typology === 'tower' && ['slab', 'shouldered', 'offset', 'paired'].includes(family);
    if (!tower && (!compatible || (family !== 'terrace' && family !== 'divided'))) continue;
    for (let attempt = 0; attempt < MAX_FAMILY_ATTEMPTS; attempt++) {
      const candidate = tower
        ? towerRecipe(site, reference, draws, family, attempt)
        : roofRecipe(site, reference, draws, family === 'divided', 1 - attempt * 0.2);
      if (occupiedArea(candidate.bands) > 0 && validComposition(site, candidate, reference)) {
        yield candidate;
        break;
      }
    }
  }
  if (!simple) yield reference;
}

export function compositionCandidates(
  site: Site,
  reference: OccupiedComposition,
  draws: CompositionDraws
): OccupiedComposition[] {
  return [...compositionOptions(site, reference, draws)];
}
