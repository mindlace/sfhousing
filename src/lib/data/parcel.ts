// Shared seam (I1, I6). Owned by data-pipeline. Shapes are fixed by the design's interface table; do not change them (extended by the 2026-10-19 underwater-lots spec).

/** SF `mapblklot` (block+lot, e.g. "3512008"), the single join key across all data. */
export type ParcelId = string;

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
  neighborhood: string;
}
