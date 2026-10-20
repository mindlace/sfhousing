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

export const MAX_COMPOSITION_PARTS = 8;
export const MAX_ROOF_ACCENTS = 2;
export const MAX_COMPOSITION_VERTICES = 128;
export const MAX_FAMILY_ATTEMPTS = 4;
export const MIN_TOWER_PLATE_M2 = 150;
export const MIN_TOWER_CORE_INSET_M = 3;
export const TOWER_SEPARATION_M = 6;

// Large-site massing (spec 2026-10-19-large-site-massing §4.1–4.2, §4.8). Tier per §4.8.

/** A site whose domain, summed over all pieces, is at least this is a district (§4.1). Tier 2. */
export const DISTRICT_MIN_M2 = 20_000;
/** Block length along `u`: median SF near-rectangular assessor block, net of streets. Tier 2. */
export const BLOCK_U_M = 167;
/** Block depth along `v`: median SF near-rectangular assessor block, net of streets. Tier 2. */
export const BLOCK_V_M = 73;
/** Synthetic street gap: SF's standard 64 ft residential right-of-way. Tier 3. */
export const STREET_M = 19.5;
/** Maximum lot frontage along `u`; a median block splits into 2 × 4 lots (§4.8). Tier 4. */
export const LOT_FRONTAGE_M = 45;
/** A block splits back to back only when at least twice this deep across `v`. Tier 4. */
export const LOT_DEPTH_MIN_M = 20;
/** Smallest district lot: `selectTypology`'s smallest podium lot (`select.ts`). Tier 4. */
export const LOT_MIN_M2 = 400;
/** Smaller blocks are dropped and left as unbuilt ground (§4.2 step 2). Tier 4. */
export const BLOCK_MIN_M2 = 1000;
/** Default open-space share of block area when there is no curated DA figure. Tier 4. */
export const OPEN_SPACE_SHARE = 0.15;
/** Record filter for `districtMaxStories` (§4.6). Tier 4. */
export const DISTRICT_DEFAULT_MIN_UNITS = 100;
/** Lower bound of the drawn district heights. Tier: partner ruling (spec §8). */
export const DISTRICT_MIN_STORIES = 3;
/** District story limit used only when a caller passes no `storyLimit`. Tier 4. */
export const DISTRICT_FALLBACK_LIMIT = 8;
