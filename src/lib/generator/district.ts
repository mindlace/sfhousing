import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import { MAX_STORIES } from './constants';
import { layoutDistrict, type DistrictLot } from './district-layout';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import type { GeneratedBuilding, TypologyId } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** I10 order, the tie-break for the headline typology. */
const TYPOLOGY_ORDER: readonly TypologyId[] = [
  'adu',
  'plex',
  'walkup',
  'podium',
  'midrise',
  'tower'
];

/** Lot seed: fnv1a32(`${seed >>> 0}|${lot.key}`). */
export function lotSeed(seed: number, key: string): number {
  return fnv1a32(`${seed >>> 0}|${key}`);
}

/** The lot as a site record: anchor id and labelPoint, the lot polygon, no existing development, eligible. */
export function lotRecord(anchor: ParcelRecord, lot: DistrictLot): ParcelRecord {
  return {
    ...anchor,
    polygon: lot.polygon,
    areaM2: lot.areaM2,
    existingUnits: 0,
    existingFloorAreaM2: 0,
    existingHeightM: 0,
    eligible: true
  };
}

/** Combines per-lot buildings in fill order into one I9 building (spec §4.4). Null if lots is empty. */
export function combineLots(
  anchor: ParcelRecord,
  lots: GeneratedBuilding[],
  source: GeneratedBuilding['source'],
  units: number
): GeneratedBuilding | null {
  if (!lots.length) return null;
  const byTypology = new Map<TypologyId, number>();
  let dominant = lots[0];
  let total = 0;
  let stories = 0;
  for (const b of lots) {
    byTypology.set(b.typology, (byTypology.get(b.typology) ?? 0) + b.floorAreaM2);
    if (b.floorAreaM2 > dominant.floorAreaM2) dominant = b;
    total += b.floorAreaM2;
    if (b.stories > stories) stories = b.stories;
  }
  let typology = lots[0].typology;
  for (const t of TYPOLOGY_ORDER) {
    const area = byTypology.get(t);
    // `>=` in ascending I10 order: a tie goes to the later typology
    if (area !== undefined && area >= byTypology.get(typology)!) typology = t;
  }
  return {
    parcelId: anchor.id,
    source,
    typology,
    composition: dominant.composition,
    parts: lots.flatMap((b, lot) => b.parts.map((p) => ({ ...p, lot }))),
    stories,
    units,
    floorAreaM2: round1(total),
    replacesExisting: true,
    lots: lots.map((b) => ({
      typology: b.typology,
      stories: b.stories,
      floorAreaM2: b.floorAreaM2
    }))
  };
}

/** Paint and yields: every non-open-space lot at env.maxStories, max buildout. */
export function generateDistrict(
  parcel: ParcelRecord,
  env: Envelope,
  seed: number
): GeneratedBuilding | 'not-district' | null {
  if (!parcel.eligible) return null;
  if (env === null || typeof env !== 'object') return null;
  const lp = parcel.labelPoint;
  if (!Array.isArray(lp) || lp.length !== 2 || !Number.isFinite(lp[0]) || !Number.isFinite(lp[1]))
    return null;
  let S = Math.floor(env.maxStories);
  if (!Number.isFinite(S) || S < 1) return null;
  if (S > MAX_STORIES) S = MAX_STORIES;

  const layout = layoutDistrict(parcel.polygon, seed);
  if (!layout.lots.length) return 'not-district';

  const built: GeneratedBuilding[] = [];
  let units = 0;
  for (const lot of layout.lots) {
    // lots are under DISTRICT_MIN_M2, so this never recurses into the district path
    const b = generate(lotRecord(parcel, lot), { maxStories: S }, lotSeed(seed, lot.key), 'max');
    if (!b) continue;
    built.push(b);
    units += b.units;
  }
  const district = combineLots(parcel, built, 'user', units);
  if (!district) return null;
  // I8 over the district as a whole (§4.3)
  if (!(district.floorAreaM2 > parcel.existingFloorAreaM2 && units > parcel.existingUnits))
    return null;
  return district;
}
