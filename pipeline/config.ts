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
  floors_m: 3.1,
  default_height_m: 7.0,
  // 8 m per conductor ruling C2; spec §4.8 says 3 m but 3 m exceeds V11's 150 KB on live data
  nb_simplify_m: 8.0
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
  scenarioMaxBytes: 3.5e6
};

/**
 * The mini fixture's known answers (pipeline/test/fixtures/mini/README.md): Σ units
 * 2+6+4+3+1+2+0+12+0+3+3+7+5+40 = 88 exactly, 14 parcels, 12/14 matched land use, 9/10 kept
 * buildings with hs ≠ 3, max parcel height 60 m (lot 14), 2 neighborhoods,
 * 8 transit stops, one BART station.
 */
export const FIXTURE_PROFILE: InvariantProfile = {
  unitsTarget: 88,
  unitsTol: 0,
  parcelRange: [14, 14],
  landUseMatchMin: 0.8,
  heightCoverageMin: 0.5,
  pieceAreaParcelMin: 0.5,
  neighborhoodNames: 'from-source',
  neighborhoodCount: 2,
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
  // Ruling: 10 of the 12 eligible mini parcels have a 2025 roll row (lots 12 and 13 do not).
  rollJoinMin: 0.8,
  // Spec §4.10 V18 "fixture exact": Σ 2025 roll units of the mini fixture (known answer).
  scenarioUnitsRange: [66, 66],
  scenarioMaxBytes: LIVE_PROFILE.scenarioMaxBytes
};
