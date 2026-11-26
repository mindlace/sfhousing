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
  // A fit is ambiguous when the score at its refined peak is under this share of the best cell's
  // (the refined peak fell in a valley between two maxima). The eaves case scores 0.88.
  regPeakFloor: 0.75,
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
  // Terraces: a building whose raised cells' p95 - p5 reaches taperMinRiseM is sliced into
  // stacked terraces instead of a main roof and steps. Levels start at the p5 and are
  // max(stepGapM, rise / taperTiers) apart; a level samples cells taperSampleFrac of a band above
  // it, without rough cells at taperRoughM. A level's region that is its parent's only child and
  // keeps taperMergeShare of its area extends the parent's terrace. The cap is taperTiers x 2.
  taperMinRiseM: 40,
  taperTiers: 16,
  taperMergeShare: 0.98,
  taperRoughM: 1,
  taperSampleFrac: 0.5,
  // Roofs.
  roofBinM: 0.5,
  roofMainShareMin: 0.25,
  raisedHagM: 1.5,
  pitchMinRiseM: 1.0,
  pitchMinSlope: 0.18,
  pitchMinR2: 0.6,
  // A pitched fit also needs the median local slope over the raised cells (h Gaussian-smoothed at
  // pitchSlopeSigmaCells against LiDAR noise) to be at least pitchSlopeShareMin x the fitted
  // slope: a stepped roof fits a plane but is flat almost everywhere.
  pitchSlopeSigmaCells: 2,
  pitchSlopeShareMin: 0.5,
  // Coverage.
  groundShareMin: 0.8,
  coverageMin: 0.5,
  minInteriorM2: 4,
  // Landmark parts: 5 roof tiers.
  partTiers: 5,
  partTierShapes: ['pyramidal', 'dome', 'cone', 'onion'],
  // Parts the LiDAR disputes: a checked part whose drawn top differs from the median raised LiDAR
  // height over the cells it alone shows by more than max(partTolM, partTolFrac x top) is
  // disputed; the parts are rejected when the disputed ones cover partRejectShare of all parts.
  partTolM: 5,
  partTolFrac: 0.1,
  partRejectShare: 0.25,
  // The uncovered area loses slivers under 2x this wide (an opening): part and footprint edges
  // that should coincide differ by mm to cm after the lng/lat round trip.
  partSliverM: 0.05,
  splitZoom: 14,
  heightRangeM: [2.5, 340]
} as const;
