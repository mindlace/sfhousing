import { FTF_M } from '../src/lib/generator/constants';
import { BAND_MAX_M } from './sb79-config';

export const BBOX = { w: -122.53, s: 37.69, e: -122.34, n: 37.84 } as const;
export const CELL_SIZE_M = 1000;
export const TOOL_VERSIONS = {
  tippecanoe: '2.79.0',
  pmtiles: '1.31.2',
  duckdb: '1.5.6',
  node: '>=22'
} as const;
export const SQL_VARS = {
  min_piece_m2: 2.0,
  iou_min: 0.5,
  // Storey height: the generator's FTF_M, the one source the codec's existingHeightM also uses.
  floors_m: FTF_M,
  default_height_m: 7.0,
  // 8 m per conductor ruling C2; spec §4.8 says 3 m but 3 m exceeds V11's 150 KB on live data
  nb_simplify_m: 8.0,
  // 45_land.sql (docs/dev/pipeline.md "Land mask"). A lot that loses less land than this keeps its
  // geometry exactly. Tier 4, from the 2026-10-19 spike.
  land_min_removed_m2: 5.0,
  // Simplification of the land mask, so a clipped edge does not follow every coastline vertex.
  // Tier 4, from the 2026-10-19 spike.
  land_simplify_m: 0.5,
  // Buffer out and back by this, to close the seams between tiles. Tier 4, from the 2026-10-19 spike.
  land_seam_m: 0.05,
  // Grid cell the mask is cut into, so a lot is intersected with a few small pieces of it, not the
  // whole city. Tier 4, from the 2026-10-19 spike.
  land_cell_m: 250,
  // 82_policy.sql pol_tod: ½ mile, 804.672 m, SB 79's outer band (Gov. Code §65912.157(a),
  // tier 1; pipeline/sb79-config.ts).
  tod_half_m: BAND_MAX_M[3],
  // 83_frontage.sql lot-to-street frontage (docs/dev/pipeline.md "Street frontage"); all tier 4,
  // chosen for SF rights of way and lot widths and pinned by pipeline/test/frontage-sql.test.ts.
  // Farthest a lot may lie from a centerline and front it: the widest common SF right of way is
  // 125 ft (≈ 38 m), so half is about 19 m; the rest covers setbacks and plazas. Tier 4.
  front_max_m: 40,
  // A lot's facing edge is its boundary within (its distance to the segment + this). Tier 4.
  front_tol_m: 2,
  // Least facing edge that fronts: a 25 ft lot plus up to 2 × 2 m of side edges passes; a corner
  // touch (≤ 4 m) does not. Tier 4.
  front_min_m: 5,
  // A probe line crossing another parcel by more than this is blocked by it. Tier 4.
  occlude_min_m: 0.5,
  // Least shared boundary for two lots to be neighbours (one lot deep). Tier 4.
  adjacent_min_m: 3
} as const;
export const KNOWN_LANDUSE = [
  'RESIDENT',
  'MIXRES',
  'VACANT',
  'MIXED',
  'MIPS',
  'RETAIL/ENT',
  'OPENSPACE',
  'CIE',
  'PDR',
  'MED',
  'VISITOR'
] as const; // + null -> UNKNOWN = 12 values
export const INELIGIBLE = ['OPENSPACE', 'NONE'] as const;
export const FONT_STACKS = {
  'Noto Sans Regular': 'NotoSans-Regular',
  'Noto Sans Medium': 'NotoSans-Medium',
  'Noto Sans Italic': 'NotoSans-Italic'
} as const;
export const FONTS_COMMIT = '028c18f713baecad011301ff7a69acc39bcc2ae7';
export const BASEMAP_BUILD = '20261009';
export const R2_BUCKET = 'sfhousing';
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Mutable run-time settings (set by the CLI before steps run). */
export const config: { renderSource: 'overture' | 'datasf' } = { renderSource: 'overture' };

export interface InvariantProfile {
  unitsTarget: number;
  unitsTol: number;
  parcelRange: [number, number];
  landUseMatchMin: number;
  heightCoverageMin: number;
  pieceAreaParcelMin: number;
  neighborhoodNames: 'from-source' | string[];
  /** Required feature count of neighborhoods.geojson (V7); null = not checked. */
  neighborhoodCount: number | null;
  labelInsideMin: number;
  maxChunkParcels: number;
  maxChunkRaw: number;
  maxChunkGzip: number;
  maxHeightRange: [number, number];
  z12BuildingsMax: number;
  z12BasemapMax: number;
  manifestMax: number;
  neighborhoodsMax: number;
  /** V14: minimum stops in transit.json. */
  transitMinStops: number;
  /** V14: each name (case-insensitive substring) must be a stop with heavy-rail service > 0 tph. */
  transitHeavyRailStations: string[];
  /** V16: minimum share of eligible parcels with a height district in parcels.bin. */
  heightJoinMin: number;
  /** V18: minimum share of eligible parcels with a latest-year assessor roll row. */
  rollJoinMin: number;
  /** V18: inclusive range of `scenario.units.total` (Σ latest-year roll units). */
  scenarioUnitsRange: [number, number];
  /** V19: maximum size of scenarios/fzp/parcels.bin on disk, bytes. */
  scenarioMaxBytes: number;
  /** V21: Σ in-flight units ≥ this × Σ `new_pipeline_units` of the matched population rows. */
  pipelineCoverageMin: number;
  /**
   * V22: Housing Inventory net units per calendar year (2025 HI Table 2 "Net Change in Number of
   * Units", p.17; project-records spec §4.9).
   */
  hiNet: Record<number, number>;
  /** V22: relative tolerance per cross-check year. */
  rhnaYearTol: number;
  /** V22: relative tolerance on the cross-check total. */
  rhnaTotalTol: number;
  /** V20: projects.json size limit (engineering budget). */
  projectsMaxBytes: number;
  /** V20: above this projects.json passes with a warning. */
  projectsWarnBytes: number;
  /** V30: judge each T14 rule's share against its warnShare and failShare (live only). */
  qualityShares: boolean;
  /** V31: minimum share of parcels with a historic status code in policy.bin. */
  historicJoinMin: number;
  /** V31: minimum share of exemption table rows whose apn matches an active parcel. */
  exemptJoinMin: number;
  /** V31: maximum size of scenarios/fzp/policy.bin on disk, bytes. */
  policyMaxBytes: number;
  /** V32: minimum SB 79 tier-1 TOD stops (`policy.sb79.stops.tier1`). */
  sb79MinT1Stops: number;
  /** V32: minimum SB 79 tier-2 TOD stops (`policy.sb79.stops.tier2`). */
  sb79MinT2Stops: number;
  /** V32 warns (still passes) when the share of parcels within ½ mile of a stop is outside it. */
  todShareWarn: [number, number] | null;
  /** V34: maximum size of scenarios/fzp/frontage.bin on disk, bytes. */
  frontageMaxBytes: number;
  /** V34: minimum share of eligible parcels with a depth-0 frontage entry. */
  frontageMin: number;
}

/**
 * SF housing stock at end-2022, 413,208 units: 2023 Housing Inventory, Table 1 (tier 1; the V1
 * source, `HOUSING_STOCK.end2022` in pipeline/steps/build.ts). Also LIVE_PROFILE.unitsTarget.
 */
const HOUSING_STOCK_END_2022 = 413208;

/** Spec §4.9 invariants for the full San Francisco build (expects 41 neighborhoods). */
export const LIVE_PROFILE: InvariantProfile = {
  unitsTarget: HOUSING_STOCK_END_2022,
  unitsTol: 0.02,
  parcelRange: [140000, 170000],
  landUseMatchMin: 0.99,
  heightCoverageMin: 0.95,
  pieceAreaParcelMin: 0.95,
  neighborhoodNames: 'from-source',
  neighborhoodCount: 41,
  labelInsideMin: 0.9999,
  maxChunkParcels: 6000,
  maxChunkRaw: 1.5e6,
  maxChunkGzip: 350e3,
  maxHeightRange: [300, 340],
  z12BuildingsMax: 2.0e6,
  z12BasemapMax: 1.2e6,
  manifestMax: 64e3,
  neighborhoodsMax: 150e3,
  transitMinStops: 3000,
  transitHeavyRailStations: [
    'Embarcadero',
    'Montgomery',
    'Powell',
    'Civic Center',
    '16th',
    '24th',
    'Glen Park',
    'Balboa Park'
  ],
  // Scenario-data spec §4.10 V16: a check bound (tier 4, made up), not simulation data.
  heightJoinMin: 0.99,
  // Spec §4.10 V18: a check bound (tier 4, made up).
  rollJoinMin: 0.97,
  // Spec §4.10 V18: [0.90, 1.02] (tier 4 band) × 413,208 (HOUSING_STOCK.end2022, 2023 Housing
  // Inventory Table 1, tier 1); the live roll Σ is ≈ 389,527 ≈ 0.943 × 413,208 (verified against live wv5m-vpq2, spec §4.10).
  scenarioUnitsRange: [0.9 * HOUSING_STOCK_END_2022, 1.02 * HOUSING_STOCK_END_2022],
  // Spec §4.10 V19: size budget for parcels.bin (tier 4; the file is expected ≈ 2.3–2.8 MB).
  scenarioMaxBytes: 3.5e6,
  pipelineCoverageMin: 0.9,
  hiNet: { 2023: 2544, 2024: 1603, 2025: 2669 },
  rhnaYearTol: 0.1,
  rhnaTotalTol: 0.05,
  projectsMaxBytes: 2e6,
  projectsWarnBytes: 1e6,
  // Spec §4.10 V30: live shares are judged against each rule's warnShare and failShare.
  qualityShares: true,
  // V31 check bounds (tier 4, made up). 3tsw-4idn lists 163,288 apns for about 155k parcels.
  historicJoinMin: 0.95,
  exemptJoinMin: 0.95,
  // Plan Budget decision: 1.0 MB each (tier 4); they warn at 0.75 MB (check-policy.ts).
  policyMaxBytes: 1.0e6,
  // V32 check bounds (tier 4, made up): at least one tier-1 stop per SF BART station
  // (transitHeavyRailStations), and far fewer tier-2 stops than MUNI_TIER2_STOP_IDS's 438.
  sb79MinT1Stops: 8,
  sb79MinT2Stops: 50,
  // Warn band (tier 4) around Planning's "more than 75%" of parcels within ½ mile of a TOD stop
  // (Ord. 082-26 §2(e), tier 1).
  todShareWarn: [0.6, 0.95],
  frontageMaxBytes: 1.0e6,
  // V34 check bound (tier 4, made up): nearly every eligible SF lot fronts a city street; the rest
  // are interior, rear or right-of-way-isolated lots.
  frontageMin: 0.9
};

/**
 * The mini fixture's known answers (pipeline/test/fixtures/mini/README.md): Σ units
 * 2+6+4+3+1+2+0+12+0+3+3+7+5+40 (+0 on shoreline lots 15-17) +2 (lot 18) = 90 exactly,
 * 18 parcels, 16/18 matched land use, 10/11 kept buildings with hs ≠ 3, max parcel height 60 m (lot 14),
 * 3 neighborhoods, 8 transit stops, one BART station.
 */
export const FIXTURE_PROFILE: InvariantProfile = {
  unitsTarget: 90,
  unitsTol: 0,
  parcelRange: [18, 18],
  landUseMatchMin: 0.8,
  heightCoverageMin: 0.5,
  pieceAreaParcelMin: 0.5,
  neighborhoodNames: 'from-source',
  neighborhoodCount: 3,
  labelInsideMin: 1,
  maxChunkParcels: LIVE_PROFILE.maxChunkParcels,
  maxChunkRaw: LIVE_PROFILE.maxChunkRaw,
  maxChunkGzip: LIVE_PROFILE.maxChunkGzip,
  maxHeightRange: [59, 61],
  z12BuildingsMax: LIVE_PROFILE.z12BuildingsMax,
  z12BasemapMax: LIVE_PROFILE.z12BasemapMax,
  manifestMax: LIVE_PROFILE.manifestMax,
  neighborhoodsMax: LIVE_PROFILE.neighborhoodsMax,
  transitMinStops: 8,
  transitHeavyRailStations: ['Fixture Station'],
  // Spec §4.10 V16: every eligible mini parcel has a district (fixture known answer).
  heightJoinMin: 1,
  // Ruling: 13 of the 15 eligible mini parcels have a 2025 roll row (lots 12 and 13 do not; lot 16
  // is underwater, so not eligible).
  rollJoinMin: 0.8,
  // Spec §4.10 V18 "fixture exact": Σ 2025 roll units of the mini fixture after the units rules
  // (known answer, spec §4.11): 66, plus lot 3's 5,000 replaced by its LUDB 4 (RA1), plus the 2
  // homes on underwater lot 16 (kept: the land mask makes a lot unbuildable, not empty), plus lot
  // 18's 2.
  scenarioUnitsRange: [74, 74],
  scenarioMaxBytes: LIVE_PROFILE.scenarioMaxBytes,
  // Project-records spec §4.9 V21 fixture "≥ 0.90": M16's linked row (220) and its record (200)
  // disagree, and M18's dropped row matches nothing, so mini covers 699 of 739 (0.946).
  pipelineCoverageMin: 0.9,
  hiNet: { 2023: 3, 2024: 2, 2025: -1 },
  rhnaYearTol: LIVE_PROFILE.rhnaYearTol,
  rhnaTotalTol: LIVE_PROFILE.rhnaTotalTol,
  projectsMaxBytes: LIVE_PROFILE.projectsMaxBytes,
  projectsWarnBytes: LIVE_PROFILE.projectsWarnBytes,
  // Spec §4.10 V30: the mini fixture fires rules on a handful of rows by design, so its shares
  // mean nothing; V30 still requires every rule to report.
  qualityShares: false,
  // Fixture known answers: every lot but 18 has a historic row (17/18); 2 of the 3 exemption rows
  // match an active parcel (lots 12 and 15; `3512999` is the unmatched stand-in pseudo-lot).
  historicJoinMin: 17 / 18,
  exemptJoinMin: 2 / 3,
  policyMaxBytes: LIVE_PROFILE.policyMaxBytes,
  // Fixture known answers (mini README "Transit"): tier 1 FX-1 (BART) and 70011, 70012 (80
  // Caltrain trains a day at the station); tier 2 m4, m5 (Muni N light rail).
  sb79MinT1Stops: 3,
  sb79MinT2Stops: 2,
  todShareWarn: null,
  frontageMaxBytes: LIVE_PROFILE.frontageMaxBytes,
  // Fixture known answer (mini README "Streets"): 12 of the 15 eligible lots front a street at
  // depth 0; shoreline lots 15 and 17 have none near, and lot 18 is only one lot deep.
  frontageMin: 0.8
};
