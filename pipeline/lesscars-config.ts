// /lesscars pipeline parameters (docs/superpowers/specs/2026-11-01-lesscars-design.md). Every value
// carries a source and an evidence tier (0 per-record … 4 invented; plan "Evidence hierarchy"),
// as pipeline/sb79-config.ts does. Tier 4 values are labelled invented: builder's or owner's
// assumptions with no source behind the number.
import path from 'node:path';
import type { TieredCite } from './sb79-config';

const SPEC = 'docs/superpowers/specs/2026-11-01-lesscars-design.md';

function invented(what: string): TieredCite {
  return { source: `Invented (tier 4): ${what}. ${SPEC}`, url: null, asOf: '2026-11', tier: 4 };
}

export const LC = {
  /**
   * Day the law switches from FZP alone to the larger of FZP and SB 79 (spec "Law"): 2032-01-31,
   * the retired CURRENT_LAW_SWITCH day. An owner-accepted assumption, not a known lapse date.
   */
  switchDay: '2032-01-31',
  /** Half-width of a kept centreline's corridor, removed from freed land, metres. */
  keepHalfM: 10,
  /** Service strip kept along every parcel edge, metres. */
  accessM: 6,
  /** Freed pieces are cut across the line at no more than this spacing along it, metres. */
  lotMaxM: 60,
  /** Freed pieces smaller than this are dropped, m². */
  minPieceM2: 100,
  /** A freed piece's neighbours: parcels within this distance, metres. */
  neighbourM: 40,
  /** A basemap road within this of a removed line is near it, metres. */
  basemapBandM: 25,
  /** Task 6: a basemap feature at least this much in band is the removed stretch's. */
  basemapMinShare: 0.9,
  /** Basemap zooms where a highway feature spans the cut, measured by `lesscars-basemap`. */
  basemapClipZooms: [11, 12, 13, 14, 15] as number[],
  /** Freeway land (spec "My call"): a parcel within this of a segment's streets is a candidate, metres. */
  freewayBandM: 60,
  /** Freeway land (spec): a candidate has at least this share of its area within the band. */
  freewayMinShare: 0.5
} as const;

export const LC_CITE: Record<keyof typeof LC, TieredCite> = {
  switchDay: invented(
    'switch day 2032-01-31, the retired CURRENT_LAW_SWITCH day (docs/dev/sim-levers.md at ' +
      '53e8d5f), accepted by the owner'
  ),
  keepHalfM: invented(
    '10 m half-width kept for every live street crossing or bordering freed land'
  ),
  accessM: invented('6 m service strip along every parcel edge'),
  lotMaxM: invented('60 m maximum lot length along a removed line'),
  minPieceM2: invented('100 m² smallest freed piece kept'),
  neighbourM: invented('40 m neighbour search radius for a freed piece’s zoning'),
  basemapBandM: invented('25 m band: a basemap road within it of a removed line is near it'),
  basemapMinShare: invented('0.9: a feature this much in band is the removed stretch’s'),
  basemapClipZooms: invented(
    'zooms where a basemap highway merges across a cut, measured (docs/dev/lesscars.md "Basemap ids")'
  ),
  freewayBandM: invented(
    '60 m candidate band for freeway land, the spec’s own call (2026-11-03-lesscars-v1-1-design.md "Freeway land")'
  ),
  freewayMinShare: invented(
    '"at least half within" the band, inclusive (2026-11-03-lesscars-v1-1-design.md "Freeway land")'
  )
};

const PIPELINE_DIR = import.meta.dirname;

/** The plan document: live (absent until the authored plan lands), and the mini fixture's. */
export const LESSCARS_PLAN_JSON = {
  live: path.join(PIPELINE_DIR, 'enrichment/lesscars/plan.json'),
  fixture: path.join(PIPELINE_DIR, 'test/fixtures/mini/enrichment/lesscars-plan.json')
};

/**
 * The freeway-land catalog (`pipeline/lib/lesscars/freeway-land.ts`): live (its segments have empty
 * parcel lists until Plan B curates it, so a live build marks no parcel), and the mini fixture's.
 */
export const LESSCARS_FREEWAY_LAND_JSON = {
  live: path.join(PIPELINE_DIR, 'enrichment/lesscars/freeway-land.json'),
  fixture: path.join(PIPELINE_DIR, 'test/fixtures/mini/enrichment/lesscars-freeway-land.json')
};

/**
 * The curated basemap id list (`pipeline/lib/lesscars/basemap-ids.ts`): live (absent until Plan B
 * curates it, so a live build checks no ids), and the mini fixture's.
 */
export const LESSCARS_BASEMAP_IDS_JSON = {
  live: path.join(PIPELINE_DIR, 'enrichment/lesscars/basemap-ids.json'),
  fixture: path.join(PIPELINE_DIR, 'test/fixtures/mini/enrichment/lesscars-basemap-ids.json')
};
