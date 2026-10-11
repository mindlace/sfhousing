import type { ReplacementTypology, TypologyId } from './types';

export const FTF_M = 3.1;
/** Ground floor of podium, midrise and tower only (OD-7, OQ-2). */
export const GROUND_FTF_M = 4.5;
export const EFFICIENCY = 0.8;
export const AVG_UNIT_M2: Record<TypologyId, number> = {
  adu: 55,
  plex: 85,
  walkup: 70,
  podium: 65,
  midrise: 65,
  tower: 70
};
/** Base-footprint coverage; for `tower` this is the podium coverage. */
export const COVERAGE: Record<ReplacementTypology, number> = {
  plex: 0.6,
  walkup: 0.7,
  podium: 0.8,
  midrise: 0.75,
  tower: 0.8
};
export const TOWER_COVERAGE = 0.35;
export const TOWER_PLATE_MAX_M2 = 900;
export const TOWER_PODIUM_STORIES = 5;
export const MIDRISE_STEPBACK_ABOVE = 6;
export const MAX_STORIES = 80;
export const MIN_SITE_M2 = 40;
export const MIN_WIDTH_INSET_M = 1.5;
export const ADU_MIN_OPEN_M2 = 60;
export const ADU_MAX_WIDTH_M = 6.0;
export const ADU_EDGE_GAP_M = 1.0;
export const PLEX_MAX_UNITS = 4;
export const SIMPLIFY_EPS_M = 0.1;
export const CLIPPER_PRECISION = 2;

/** Pieces of base/upper regions smaller than this are dropped (§4.4.6, §4.6). */
export const MIN_PIECE_M2 = 10;
/** Tower plate is fitted inside the podium inset by this much (§4.7). */
export const TOWER_INSET_M = 1.0;
/** ADU is fitted inside the site inset by this much (§4.8). */
export const ADU_INSET_M = 1.0;
/** ADU gross area = 55 / EFFICIENCY (§4.8). */
export const ADU_GROSS_M2 = AVG_UNIT_M2.adu / EFFICIENCY;

export interface TypologyRules {
  coverage: number;
  avgUnitM2: number;
  groundFtfM: number;
  maxUnits: number;
}

/** Per-typology rule table. M3 (policy-levers) overrides values here per envelope. */
export function rulesFor(typ: TypologyId): TypologyRules {
  return {
    coverage: typ === 'adu' ? 0 : COVERAGE[typ],
    avgUnitM2: AVG_UNIT_M2[typ],
    groundFtfM: typ === 'podium' || typ === 'midrise' || typ === 'tower' ? GROUND_FTF_M : FTF_M,
    maxUnits: typ === 'plex' ? PLEX_MAX_UNITS : typ === 'adu' ? 1 : Number.POSITIVE_INFINITY
  };
}
