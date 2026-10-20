import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import type { AssembledSite } from './assemble';
import { drawComposition } from './composition-variety';
import {
  DISTRICT_FALLBACK_LIMIT,
  DISTRICT_MIN_STORIES,
  MAX_STORIES,
  OPEN_SPACE_SHARE
} from './constants';
import { layoutDistrict, type DistrictLot } from './district-layout';
import { generate } from './generate';
import { fnv1a32, mulberry32 } from './seed';
import type { GeneratedBuilding, TypologyId } from './types';
import { generateForUnitsWith } from './units';
import { drawVariety } from './variety';

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

/** District inputs to `generateForUnits` (spec §4.3 "Pipeline and phases", "Story limit L"). */
export interface DistrictOpts {
  /** L before clamping; absent → DISTRICT_FALLBACK_LIMIT. */
  storyLimit?: number;
  /** Tier-1 DA height; every lot uses it. */
  curatedStories?: number;
  /** Curated open-space share; absent → OPEN_SPACE_SHARE. */
  openSpaceShare?: number;
}

/** A finite story count whose floor is in 1..MAX_STORIES, floored; else null. */
const validStories = (x: number | null | undefined): number | null => {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const S = Math.floor(x);
  return S >= 1 && S <= MAX_STORIES ? S : null;
};

/**
 * Pipeline and phases (spec §4.3): masses lots in fill order at `S_ℓ` until `U` units are used,
 * the last lot scaled to the remainder with `generateForUnitsWith`. If the lots run out first,
 * they are raised to `L` in fill order (never when `stated` is valid); if even that is short, the
 * result is approximate. `units` is always `U`. 'not-district' when the layout has no lot.
 * `U` and `stated` arrive validated by `generateForUnits` (`stated` null when absent or invalid).
 */
export function generateDistrictForUnits(
  assembled: AssembledSite,
  U: number,
  seed: number,
  stated: number | null,
  opts: DistrictOpts
): GeneratedBuilding | 'not-district' | null {
  const s = seed >>> 0;
  const { anchor, polygon } = assembled;
  const limit = Math.floor(opts.storyLimit ?? DISTRICT_FALLBACK_LIMIT);
  // NaN (a non-number limit) falls back; ±Infinity clamps like any other value
  const L = Number.isNaN(limit)
    ? DISTRICT_FALLBACK_LIMIT
    : Math.min(Math.max(limit, DISTRICT_MIN_STORIES), MAX_STORIES);
  const curated = validStories(opts.curatedStories);
  const share = opts.openSpaceShare ?? OPEN_SPACE_SHARE;

  const layout = layoutDistrict(polygon, s, share);
  if (!layout.lots.length) return 'not-district';

  type Built = { record: ParcelRecord; ls: number; S: number; b: GeneratedBuilding };
  const built: Built[] = [];
  // the lot that reaches the remainder: its own units-targeted massing (spec §4.3 step 2). A
  // stated tier-0 count is massed exactly; otherwise the lot keeps the stories its own `generate`
  // massing reached, so the lot-area cap chain holds for it as for every other lot (R1).
  const remainder = (lot: Built, remaining: number): GeneratedBuilding =>
    generateForUnitsWith(
      lot.record,
      remaining,
      L,
      drawVariety(lot.ls),
      drawComposition(lot.ls),
      stated ?? lot.b.stories
    ) ?? lot.b;
  const result = () =>
    combineLots(
      anchor,
      built.map((l) => l.b),
      'pipeline',
      U
    );

  // step 1–2: S_ℓ per lot, fill in order
  let remaining = U;
  for (const lot of layout.lots) {
    const ls = lotSeed(s, lot.key);
    const S =
      stated ??
      curated ??
      DISTRICT_MIN_STORIES + Math.floor(mulberry32(ls)() * (L - DISTRICT_MIN_STORIES + 1));
    const record = lotRecord(anchor, lot);
    // lots are under DISTRICT_MIN_M2, so this never recurses into the district path
    const b = generate(record, { maxStories: S }, ls, 'max');
    if (!b) continue;
    const entry = { record, ls, S, b };
    built.push(entry);
    if (b.units >= remaining) {
      entry.b = remainder(entry, remaining);
      return result();
    }
    remaining -= b.units;
  }

  // step 3: the lots ran out first; raise them to L in fill order. A stated count never changes,
  // and a lot already at or above L (a curated height over L) is left as it is.
  if (stated === null) {
    for (const entry of built) {
      if (entry.S >= L) continue;
      const b = generate(entry.record, { maxStories: L }, entry.ls, 'max');
      if (!b) continue;
      const before = entry.b.units;
      entry.S = L;
      entry.b = b;
      if (b.units - before >= remaining) {
        entry.b = remainder(entry, before + remaining);
        return result();
      }
      remaining -= b.units - before;
    }
  }
  // still short: everything stays at L and the result is approximate
  return result();
}
