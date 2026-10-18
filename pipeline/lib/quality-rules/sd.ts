import type { QualityRule } from '../quality';

/**
 * scenario-data's T14 rules (scenario-data spec §4.12). Each entry takes its kind's default
 * shares (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10) unless a comment
 * at the entry states why it departs. The values are literal here: this module is loaded by
 * quality.ts, so it cannot call quality.ts's `defaultShares` at load time.
 *
 * The SQL-side rules below are applied and tallied in pipeline/sql/80_scenario.sql (row level) and
 * 81_scenario_features.sql (parcel-years); the TS-side rules (no-row defaults, zoning, yield) are
 * applied and counted in pipeline/steps/scenario.ts. writeScenario reports them all once, after the
 * T11 rows: the SQL tallies through recordSqlQuality, the TS rules through recordQuality. Their
 * thresholds carry their tier and source where the code applies them.
 */
const SD = { owner: 'scenario-data' } as const;
/** Default shares (T14 row): every kind but `missing`. */
const SHARES = { warnShare: 0.01, failShare: 0.1 } as const;
/** Default shares (T14 row; ledger SD rulings 2026-10-17): routine missing-value imputations. */
const MISSING_SHARES = { warnShare: 0.05, failShare: 0.1 } as const;

export const SD_RULES: readonly QualityRule[] = [
  // ---- Row level, on src_roll (80_scenario.sql; spec §4.5 rule order step 1) ----
  // DQ-4 registered rule (controller ruling, F1 Task 3 review; ledger 2026-10-17): the as-built
  // `closed_roll_year IS NULL` drop. 0 live rows (the fetch filters closed_roll_year >= 2007). A
  // drop of an unusable row, so `shape` at the 0.01 default (spec §4.12 "Default shares").
  {
    ...SD,
    id: 'sd.roll.no-year',
    source: 'datasf-assessor-roll',
    field: 'closed_roll_year',
    kind: 'shape',
    action: 'drop',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label: 'Assessor rows without a roll year are dropped',
    denominator: 'roll rows',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.roll.year-built-range',
    source: 'datasf-assessor-roll',
    field: 'year_property_built',
    kind: 'bound',
    action: 'replace',
    tier: 4,
    valueTier: 2,
    maskBit: 0,
    label:
      'Assessor year built before 1850 or after the roll year (including 0) is treated as ' +
      'missing and takes the median of the same land-use class and roll year',
    denominator: 'roll rows with a year',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.roll.stories-max',
    source: 'datasf-assessor-roll',
    field: 'number_of_stories',
    kind: 'bound',
    action: 'replace',
    tier: 4,
    valueTier: 2,
    maskBit: 1,
    label:
      'Assessor stories above 80 (the generator maximum; the tallest SF building has 61) are ' +
      'treated as missing, so the stories come from the other rows or the building height',
    denominator: 'roll rows with stories',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.roll.unmatched',
    source: 'datasf-assessor-roll',
    field: 'parcel_number',
    kind: 'shape',
    action: 'drop',
    tier: 2,
    valueTier: null,
    maskBit: null,
    label:
      'Assessor rows whose parcel number maps to no current parcel (directly, through a ' +
      'condo lot, or through a retired lot inside a current one) are dropped',
    denominator: 'roll rows',
    ...SHARES,
    unitsWeighted: true
  },
  // ---- Aggregation per parcel-year (80_scenario.sql; spec §4.5 rule order step 2) ----
  // DQ-4 registered rule (controller ruling, F1 Task 3 review; ledger 2026-10-17): the as-built
  // coalesce(sum(number_of_units), 0) of a parcel-year whose rows all have no units. 2 live
  // parcel-years. Kind `missing`, so the 0.05 default.
  {
    ...SD,
    id: 'sd.roll.units-missing',
    source: 'sc_roll_agg',
    field: 'number_of_units',
    kind: 'missing',
    action: 'default',
    tier: 4,
    valueTier: 4,
    maskBit: 3,
    label: 'A parcel-year whose assessor rows all lack a unit count has 0 units',
    denominator: 'observed parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  // ---- Parcel-years (81_scenario_features.sql; spec §4.5 rule order step 3) ----
  {
    ...SD,
    id: 'sd.features.stories-height',
    source: 'sc_roll_agg',
    field: 'stories',
    kind: 'missing',
    action: 'default',
    tier: 2,
    valueTier: 3,
    maskBit: 1,
    label:
      'Parcel-years without assessor stories take round(building height / 3.1 m), at least 1, ' +
      'when the building has a height',
    denominator: 'parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.roll.units-capacity',
    source: 'sc_roll_agg',
    field: 'number_of_units',
    kind: 'outlier',
    action: 'replace',
    tier: 4,
    valueTier: 2,
    maskBit: 3,
    label:
      'Assessor units that would leave under 10 m² of lot area times stories per home take the ' +
      'units of the nearest plausible roll year, else the city land-use count if plausible, ' +
      'else the most homes that fit',
    denominator: 'observed parcel-years',
    ...SHARES,
    unitsWeighted: true
  },
  {
    ...SD,
    id: 'sd.roll.units-spike',
    source: 'sc_roll_agg',
    field: 'number_of_units',
    kind: 'outlier',
    action: 'replace',
    tier: 4,
    valueTier: 2,
    maskBit: 3,
    label:
      'A run of roll years whose units (at least 100) are more than 10 times the years on both ' +
      'sides takes the units of the year before the run',
    denominator: 'observed parcel-years',
    ...SHARES,
    unitsWeighted: true
  },
  {
    ...SD,
    id: 'sd.roll.year-gap',
    source: 'sc_roll_agg',
    field: 'every roll column',
    kind: 'gap',
    action: 'default',
    tier: 2,
    valueTier: 2,
    maskBit: 5,
    label:
      'A roll year missing between two years in which a parcel appears copies the latest ' +
      'earlier year',
    denominator: 'panel parcel-years (observed and carried)',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.roll.units-latest-jump',
    source: 'scenario_panel',
    field: 'existing_units',
    kind: 'outlier',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Counts parcels whose latest-year units are at least 100 and more than 10 times the ' +
      'previous year (usually a new building); changes nothing',
    denominator: 'parcels with rows in the latest and the previous roll year',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.roll.units-large',
    source: 'scenario_panel',
    field: 'existing_units',
    kind: 'outlier',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Counts parcel-years with more than 500 units that no units rule replaced and that were ' +
      'not carried; changes nothing',
    denominator: 'panel parcel-years',
    ...SHARES,
    unitsWeighted: false
  },
  // ---- Features (81_scenario_features.sql; spec §4.5 rule order step 4) ----
  {
    ...SD,
    id: 'sd.features.year-built-median',
    source: 'sc_roll_agg',
    field: 'year_built',
    kind: 'missing',
    action: 'default',
    tier: 2,
    valueTier: 2,
    maskBit: 0,
    label:
      'A missing assessor year built takes the median of the same land-use class and roll year',
    denominator: 'non-vacant parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.features.share-median',
    source: 'sc_roll_agg',
    field: 'land, impr',
    kind: 'missing',
    action: 'default',
    tier: 2,
    valueTier: 2,
    maskBit: 2,
    label:
      'A parcel-year with no assessed value takes the median improvement share of the same ' +
      'land-use class and roll year',
    denominator: 'non-vacant parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.features.median-fallback',
    source: 'sc_medians',
    field: 'year_built, improvement_share',
    kind: 'missing',
    action: 'default',
    tier: 4,
    valueTier: 4,
    maskBit: null,
    label:
      'When a land-use class has no value in a roll year, its median falls back to the median ' +
      'of all non-vacant parcels that year, then to 0',
    denominator: 'values imputed by the two median rules',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  // Its `of` is panel parcel-years plus the T11 no-row parcels, and `fired` includes those
  // parcels: they take the same chunk-record floor area (controller ruling, F1 Task 3 review;
  // spec §4.5 step 5). The SQL tally row is topped up in writeScenario before it is reported.
  {
    ...SD,
    id: 'sd.roll.floor-area-missing',
    source: 'sc_roll_agg',
    field: 'property_area',
    kind: 'missing',
    action: 'default',
    tier: 2,
    valueTier: 3,
    maskBit: 6,
    label:
      'A parcel-year with no assessor floor area takes the floor area of the map parcel record ' +
      '(land-use data, else the building footprints), rounded to whole m²; counted over panel ' +
      'parcel-years plus the parcels with no latest-year roll row, which take it too',
    denominator: 'parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  // ---- TS side (pipeline/steps/scenario.ts; spec §4.5 step 5, §4.12) ----
  {
    ...SD,
    id: 'sd.roll.no-row',
    source: 'datasf-assessor-roll',
    field: 'every roll column',
    kind: 'missing',
    action: 'default',
    tier: 4,
    valueTier: 4,
    maskBit: 4,
    label:
      'A parcel with no latest-year assessor row has 0 homes, stories from the building height, ' +
      'land-use class other, the latest year’s "other" medians for year built and improvement ' +
      'share, no rent control, and the floor area of the map parcel record',
    denominator: 'T11 parcels',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.zoning.split-code',
    source: 'datasf-parcel-attrs',
    field: 'zoning_code',
    kind: 'shape',
    action: 'replace',
    tier: 4,
    valueTier: 4,
    maskBit: null,
    label:
      'A split zoning code (two districts on one parcel) takes the density cap of its most ' +
      'permissive component, or no cap when a component has none',
    // Hostable parcels: ruling A9's escalation (> 10% of hostable parcels) is what the default
    // failShare generalises (RA1).
    denominator: 'hostable parcels',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.zoning.generic-nc',
    source: 'datasf-parcel-attrs',
    field: 'zoning_code',
    kind: 'shape',
    action: 'default',
    tier: 4,
    valueTier: 4,
    maskBit: null,
    label: 'A generic NCD or NCT zoning code names no district, so the parcel has no density cap',
    denominator: 'hostable parcels',
    ...SHARES,
    unitsWeighted: false
  },
  // Observation rules take tier 4: QualityRule.tier admits only 2–4 and the design's table gives
  // "—" (ledger SD rulings 2026-10-17).
  {
    ...SD,
    id: 'sd.yield.nonmonotone',
    source: 'parcels.bin',
    field: 'yield',
    kind: 'shape',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Counts parcels whose units by fill level fall at some higher fill level; changes nothing',
    denominator: 'parcels',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.yield.zero-hostable',
    source: 'parcels.bin',
    field: 'yield',
    kind: 'shape',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Counts eligible parcels with an envelope of at least one story whose top-fill yield is 0; ' +
      'changes nothing',
    denominator: 'eligible parcels with envelopeStories ≥ 1',
    ...SHARES,
    unitsWeighted: false
  }
];
