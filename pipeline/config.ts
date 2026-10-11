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
  nb_simplify_m: 3.0
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
}

/** Spec §4.9 invariants for the full San Francisco build (expects 41 neighborhoods). */
export const LIVE_PROFILE: InvariantProfile = {
  unitsTarget: 413208,
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
  neighborhoodsMax: 150e3
};

/**
 * The mini fixture's known answers (pipeline/test/fixtures/mini/README.md): Σ units
 * 2+6+4+3+1+2+0+12+0+3+3+7+5+40 = 88 exactly, 14 parcels, 12/14 matched land use, 9/10 kept
 * buildings with hs ≠ 3, max parcel height 60 m (lot 14), 2 neighborhoods.
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
  neighborhoodsMax: LIVE_PROFILE.neighborhoodsMax
};
