import type { QualityRule } from '../quality';

/**
 * scenario-data's T14 rules (scenario-data spec §4.12). Each entry takes its kind's default
 * shares (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10) unless a comment
 * at the entry states why it departs. The values are literal here: this module is loaded by
 * quality.ts, so it cannot call quality.ts's `defaultShares` at load time.
 *
 * The SQL-side rules below are applied and tallied in pipeline/sql/80_scenario.sql (row level) and
 * 81_scenario_features.sql (parcel-years), and reported by runScenarioSql through
 * recordSqlQuality. Their thresholds carry their tier and source where the SQL applies them.
 */
const SD = { owner: 'scenario-data' } as const;
/** Default shares (T14 row): every kind but `missing`. */
const SHARES = { warnShare: 0.01, failShare: 0.1 } as const;
/** Default shares (T14 row; ledger SD rulings 2026-10-17): routine missing-value imputations. */
const MISSING_SHARES = { warnShare: 0.05, failShare: 0.1 } as const;

export const SD_RULES: readonly QualityRule[] = [
  // ---- Row level, on src_roll (80_scenario.sql; spec §4.5 rule order step 1) ----
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
      '(land-use data, else the building footprints), rounded to whole m²',
    denominator: 'parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  }
];
