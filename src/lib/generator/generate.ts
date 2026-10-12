import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import { ADU_MIN_OPEN_M2, ADU_GROSS_M2, FTF_M, MAX_STORIES } from './constants';
import { compositionOptions, referenceComposition } from './compositions';
import { drawComposition } from './composition-variety';
import type { CompositionDraws, OccupiedComposition } from './composition-types';
import {
  retainsCapacityAcrossHeights,
  compositionHeightRange,
  growthRegions,
  occupiedArea,
  unitsFor
} from './bands';
import { fnv1a32 } from './seed';
import { roofAccents } from './roof';
import { serializeComposition } from './serialize';
import { massAdu } from './massing';
import { canonicalRing } from './poly';
import { domainArea } from './domain';
import { selectTypology } from './select';
import { normaliseSite, type Site } from './site';
import type { BuildoutMode, GeneratedBuilding } from './types';
import { drawVariety, type VarietyDraws } from './variety';

export interface LocalPart {
  /** Local metres, open CCW ring, same vertex order as the output footprint. */
  ring: [number, number][];
  baseM: number;
  topM: number;
  role: 'occupied' | 'roof';
  tone: 0 | 1 | 2;
}

export interface Detailed {
  building: GeneratedBuilding;
  local: LocalPart[];
  site: Site;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** §4.8 existing-footprint estimate: is there ≥ 60 m² of open lot for an ADU? */
export function aduOpenOk(parcel: ParcelRecord, A: number): boolean {
  const estStories =
    parcel.existingHeightM > 0 ? Math.max(1, Math.round(parcel.existingHeightM / FTF_M)) : 2;
  return A - parcel.existingFloorAreaM2 / estStories >= ADU_MIN_OPEN_M2;
}

export function generateDetailed(
  parcel: ParcelRecord,
  env: Envelope,
  draws: VarietyDraws,
  mode: BuildoutMode,
  compositionDraws: CompositionDraws = drawComposition(fnv1a32(parcel.id))
): Detailed | null {
  if (mode !== 'max') throw new Error('unsupported BuildoutMode');
  if (!parcel.eligible) return null;
  if (env === null || typeof env !== 'object') return null;
  const lp = parcel.labelPoint;
  if (!Array.isArray(lp) || lp.length !== 2 || !Number.isFinite(lp[0]) || !Number.isFinite(lp[1]))
    return null;
  let S = Math.floor(env.maxStories);
  if (!Number.isFinite(S) || S < 1) return null;
  if (S > MAX_STORIES) S = MAX_STORIES;

  const site = normaliseSite(parcel.polygon, draws.edgeInsetM);
  if (!site) return null;

  const sel = selectTypology(S, site.A, parcel.existingUnits);
  let reference: OccupiedComposition | null;
  if (sel.typology === 'adu') {
    if (!aduOpenOk(parcel, site.A)) return null;
    const mass = massAdu(site, sel.stories, draws);
    reference = mass && {
      family: 'simple',
      typology: 'adu',
      stories: mass.stories,
      bands: [
        {
          firstFloor: 1,
          floors: mass.stories,
          regions: mass.parts.map((p) => canonicalRing(p.ring))
        }
      ]
    };
  } else reference = referenceComposition(site, sel.typology, sel.stories, draws);
  if (!reference) return null;
  const ref = reference;
  const evaluate = function* () {
    for (const candidate of compositionOptions(site, ref, compositionDraws)) {
      const output = serializeComposition(
        parcel,
        site,
        candidate,
        roofAccents(site, candidate, compositionDraws, draws.parapetM),
        compositionDraws.tone,
        ref
      );
      if (!output || !output.parts.length) continue;
      if (
        candidate.family !== 'simple' &&
        !retainsCapacityAcrossHeights(candidate, ref, output.area, output.growth)
      )
        continue;
      yield { candidate, output };
    }
  };
  type Option = {
    candidate: OccupiedComposition;
    output: NonNullable<ReturnType<typeof serializeComposition>>;
  };
  let options: Iterable<Option> = evaluate();
  const [min, max] = compositionHeightRange(ref);
  let anchor = min;
  const gains = (typology: GeneratedBuilding['typology'], area: number) =>
    round1(area) > parcel.existingFloorAreaM2 && unitsFor(typology, area) > parcel.existingUnits;
  if (
    ref.typology !== 'adu' &&
    min !== max &&
    !gains(
      ref.typology,
      occupiedArea(ref.bands) + (min - ref.stories) * domainArea(growthRegions(ref))
    )
  ) {
    // Existing development can make different families first replaceable at different heights.
    // Evaluate the bounded set once and freeze preference at the earliest possible gain.
    const fitted = [...options];
    options = fitted;
    anchor = Infinity;
    for (const { candidate, output } of fitted)
      for (let s = min; s <= max && s < anchor; s++) {
        if (gains(candidate.typology, output.area + (s - candidate.stories) * output.growth)) {
          anchor = s;
          break;
        }
      }
    if (!Number.isFinite(anchor)) return null;
  }
  for (const { candidate, output } of options) {
    if (
      candidate.typology !== 'adu' &&
      !gains(candidate.typology, output.area + (anchor - candidate.stories) * output.growth)
    )
      continue;
    const floorAreaM2 = round1(candidate.typology === 'adu' ? ADU_GROSS_M2 : output.area);
    const replacesExisting = candidate.typology !== 'adu';
    const units = replacesExisting ? unitsFor(candidate.typology, floorAreaM2) : 1;
    if (
      units < 1 ||
      !(
        floorAreaM2 + (replacesExisting ? 0 : parcel.existingFloorAreaM2) >
        parcel.existingFloorAreaM2
      ) ||
      (replacesExisting && !(units > parcel.existingUnits))
    )
      continue;
    const building: GeneratedBuilding = {
      parcelId: parcel.id,
      source: 'user',
      typology: candidate.typology,
      composition: candidate.family,
      parts: output.parts,
      stories: candidate.stories,
      units,
      floorAreaM2,
      replacesExisting
    };
    return { building, local: output.local, site };
  }
  return null;
}

/** Same rules as `generate`, with injected draws (test seam). */
export function generateWith(
  parcel: ParcelRecord,
  env: Envelope,
  draws: VarietyDraws,
  mode: BuildoutMode,
  compositionDraws: CompositionDraws = drawComposition(fnv1a32(parcel.id))
): GeneratedBuilding | null {
  return generateDetailed(parcel, env, draws, mode, compositionDraws)?.building ?? null;
}

/** I8. Callers pass `seed = fnv1a32(parcel.id)` (I14). */
export function generate(
  parcel: ParcelRecord,
  env: Envelope,
  seed: number,
  mode: BuildoutMode
): GeneratedBuilding | null {
  if (mode !== 'max') throw new Error('unsupported BuildoutMode');
  return generateWith(parcel, env, drawVariety(seed), mode, drawComposition(seed));
}
