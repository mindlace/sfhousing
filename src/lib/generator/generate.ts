import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import { ADU_MIN_OPEN_M2, EFFICIENCY, FTF_M, MAX_STORIES, rulesFor } from './constants';
import { toLngLat } from './geo';
import { massAdu, massTypology, type Massing } from './massing';
import { canonicalRing } from './poly';
import { selectTypology } from './select';
import { normaliseSite, type Site } from './site';
import type { BuildoutMode, GeneratedBuilding } from './types';
import { drawVariety, type VarietyDraws } from './variety';

export interface LocalPart {
  /** Local metres, open CCW ring, same vertex order as the output footprint. */
  ring: [number, number][];
  baseM: number;
  topM: number;
}

export interface Detailed {
  building: GeneratedBuilding;
  local: LocalPart[];
  site: Site;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

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
  mode: BuildoutMode
): Detailed | null {
  if (mode !== 'max') throw new Error('unsupported BuildoutMode');
  if (!parcel.eligible) return null;
  let S = Math.floor(env.maxStories);
  if (!Number.isFinite(S) || S < 1) return null;
  if (S > MAX_STORIES) S = MAX_STORIES;

  const site = normaliseSite(parcel.polygon, draws.edgeInsetM);
  if (!site) return null;

  const sel = selectTypology(S, site.A, parcel.existingUnits);
  let m: Massing | null;
  if (sel.typology === 'adu') {
    if (!aduOpenOk(parcel, site.A)) return null;
    m = massAdu(site, sel.stories, draws);
  } else {
    m = massTypology(site, sel.typology, sel.stories, draws);
  }
  if (!m || m.parts.length === 0) return null;

  const floorAreaM2 = round1(m.floorAreaM2);
  const replacesExisting = m.typology !== 'adu';
  const rules = rulesFor(m.typology);
  const units = replacesExisting
    ? Math.min(rules.maxUnits, Math.floor((floorAreaM2 * EFFICIENCY) / rules.avgUnitM2))
    : 1;
  if (units < 1) return null; // N5
  const after = replacesExisting ? floorAreaM2 : parcel.existingFloorAreaM2 + floorAreaM2;
  if (after <= parcel.existingFloorAreaM2) return null; // N6
  if (replacesExisting && units <= parcel.existingUnits) return null; // N7

  const local: LocalPart[] = m.parts.map((p) => ({
    ring: canonicalRing(p.ring).map((q) => [q.x, q.y] as [number, number]),
    baseM: round2(p.baseM),
    topM: round2(p.topM + (p.reachesTop ? draws.parapetM : 0))
  }));
  const building: GeneratedBuilding = {
    parcelId: parcel.id,
    source: 'user',
    typology: m.typology,
    parts: local.map((l) => ({
      footprint: toLngLat(l.ring, parcel.labelPoint),
      baseM: l.baseM,
      topM: l.topM
    })),
    stories: m.stories,
    units,
    floorAreaM2,
    replacesExisting
  };
  return { building, local, site };
}

/** Same rules as `generate`, with injected draws (test seam). */
export function generateWith(
  parcel: ParcelRecord,
  env: Envelope,
  draws: VarietyDraws,
  mode: BuildoutMode
): GeneratedBuilding | null {
  return generateDetailed(parcel, env, draws, mode)?.building ?? null;
}

/** I8. Callers pass `seed = fnv1a32(parcel.id)` (I14). */
export function generate(
  parcel: ParcelRecord,
  env: Envelope,
  seed: number,
  mode: BuildoutMode
): GeneratedBuilding | null {
  if (mode !== 'max') throw new Error('unsupported BuildoutMode');
  return generateWith(parcel, env, drawVariety(seed), mode);
}
