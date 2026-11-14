// Building-box derivation thresholds (docs/superpowers/specs/2026-11-13-building-steps-design.md).
// Every value is a starting threshold from the spec, tier 4 (invented, tuned on the spike) unless a
// comment says otherwise. Metres unless the name says otherwise.
export const BOXES = {
  // Raster: 0.25 m height-above-ground cells, 1 m ground grid, 500 m tiles padded by 20 m.
  rasterResM: 0.25,
  groundResM: 1,
  tileSizeM: 500,
  tilePadM: 20,
  vegFracMin: 0.35,
  // Registration: search +-3 m at 0.1 m, cluster touch tolerance 1.5 m.
  regSearchM: 3,
  regStepM: 0.1,
  regTouchM: 1.5,
  regSampleStepM: 0.2,
  regMaxSamples: 2000,
  regAmbiguousRatio: 0.85,
  regSecondPeakM: 1.0,
  // Known OSM frame offsets (east, north), tier 2 (measured on the spike).
  regFrames: { 'frame-nad83': [0.0, 0.24], 'frame-wgs84': [1.24, -0.32] },
  // Footprint margin and false-front band.
  marginM: 0.3,
  frontBandM: 2.0,
  frontRiseM: 1.0,
  frontDepthM: 0.5,
  frontPct: 0.9,
  frontMinFaceM: 3,
  frontFaceAngleDeg: 15,
  frontStreetM: 30,
  frontFacingCos: 0.7,
  // Steps.
  stepMinAreaM2: 20,
  stepGapM: 2.5,
  stepCap: 4,
  treeRoughM: 1.0,
  // Roofs.
  roofBinM: 0.5,
  roofMainShareMin: 0.25,
  raisedHagM: 1.5,
  pitchMinRiseM: 1.0,
  pitchMinSlope: 0.18,
  pitchMinR2: 0.6,
  // Coverage.
  groundShareMin: 0.8,
  coverageMin: 0.5,
  minInteriorM2: 4,
  // Landmark parts: 5 roof tiers.
  partTiers: 5,
  partTierShapes: ['pyramidal', 'dome', 'cone', 'onion'],
  splitZoom: 14,
  heightRangeM: [2.5, 340]
} as const;
