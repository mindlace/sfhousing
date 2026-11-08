// Shared seam (I1, I6). Owned by data-pipeline. Shapes are fixed by the design's interface table; do not change them (extended by the 2026-10-19 underwater-lots and 2026-11-07 road-lots specs).

/** SF `mapblklot` (block+lot, e.g. "3512008"), the single join key across all data. */
export type ParcelId = string;

/** Why a lot is road-like (pipeline 55_road_lots.sql rules; `override` is the hand-kept file). */
export const ROAD_LIKE_REASONS = ['r7', 'r1n', 'r2s', 'r3', 'override'] as const;
export type RoadLikeReason = (typeof ROAD_LIKE_REASONS)[number];

export interface ParcelRecord {
  id: ParcelId;
  polygon: [
    x: number,
    y: number
  ][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */;
  labelPoint: [lng: number, lat: number];
  areaM2: number;
  existingUnits: number;
  existingFloorAreaM2: number;
  existingHeightM: number;
  landUse: string;
  eligible: boolean;
  /** Set only when true: the lot lies wholly in the water (kept for its roll homes, never scenario-eligible). */
  underwater?: true;
  /** Set only on a road-like lot (pipeline 55_road_lots.sql): never eligible. */
  roadLike?: RoadLikeReason;
  neighborhood: string;
}
