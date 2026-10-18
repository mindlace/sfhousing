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

/**
 * A normalise TRY_CAST rewrite of one field (DQ-4 registered rules, final fix wave, review
 * Important 1; spec §4.1 "Normalise no longer rewrites any value"). normalise flags the row in
 * `cast_flags` (pipeline/sources/normalise.ts) and 80_scenario.sql tallies it, over the rows with a
 * value in the field. `rounds`: an integer or date field, whose cast also rounds a fraction to
 * the nearest integer (DuckDB rounds half to even) or drops a time of day, so the action is
 * `replace` and the written value is the source's own, rounded (value tier 0); else the cast only
 * turns text that is no number into NULL (`null`). `maskBit`: the T11/T13 bit of the feature the
 * field feeds, set on the parcel-year of a flagged row. Kind `shape` at the 0.01 default; 0 live
 * firings on 2026-10-17 in every field (3,934,467 roll rows, 236,573 parcel rows).
 */
const cast = (
  source: 'datasf-assessor-roll' | 'datasf-parcel-attrs',
  id: string,
  field: string,
  rounds: boolean,
  maskBit: number | null,
  what: string,
  label: string
): QualityRule => ({
  ...SD,
  id,
  source,
  field,
  kind: 'shape',
  action: rounds ? 'replace' : 'null',
  tier: 4,
  valueTier: rounds ? 0 : null,
  maskBit,
  label,
  denominator: `${source === 'datasf-assessor-roll' ? 'roll' : 'parcel'} rows with ${what}`,
  ...SHARES,
  unitsWeighted: false
});
const ROUNDED = ', and one that is not a whole number is rounded to the nearest whole number';
const roll = 'datasf-assessor-roll';
const attrs = 'datasf-parcel-attrs';

export const SD_RULES: readonly QualityRule[] = [
  // ---- Normalise (pipeline/sources/normalise.ts, tallied in 80_scenario.sql) ----
  cast(
    roll,
    'sd.roll.roll-year-cast',
    'closed_roll_year',
    true,
    null,
    'a roll year',
    `An assessor roll year that is not a number is treated as missing${ROUNDED}`
  ),
  cast(
    roll,
    'sd.roll.year-built-cast',
    'year_property_built',
    true,
    0,
    'a year',
    `An assessor year built that is not a number is treated as missing${ROUNDED}`
  ),
  cast(
    roll,
    'sd.roll.stories-cast',
    'number_of_stories',
    true,
    1,
    'stories',
    `An assessor story count that is not a number is treated as missing${ROUNDED}`
  ),
  cast(
    roll,
    'sd.roll.units-cast',
    'number_of_units',
    true,
    3,
    'units',
    `An assessor unit count that is not a number is treated as missing${ROUNDED}`
  ),
  cast(
    roll,
    'sd.roll.floor-area-cast',
    'property_area',
    false,
    6,
    'a floor area',
    'An assessor floor area that is not a number is treated as missing'
  ),
  cast(
    roll,
    'sd.roll.land-value-cast',
    'assessed_land_value',
    false,
    2,
    'a land value',
    'An assessed land value that is not a number is treated as missing'
  ),
  cast(
    roll,
    'sd.roll.improvement-value-cast',
    'assessed_improvement_value',
    false,
    2,
    'an improvement value',
    'An assessed improvement value that is not a number is treated as missing'
  ),
  cast(
    attrs,
    'sd.attrs.latitude-cast',
    'centroid_latitude',
    false,
    null,
    'a latitude',
    'A parcel centroid latitude that is not a number is treated as missing'
  ),
  cast(
    attrs,
    'sd.attrs.longitude-cast',
    'centroid_longitude',
    false,
    null,
    'a longitude',
    'A parcel centroid longitude that is not a number is treated as missing'
  ),
  cast(
    attrs,
    'sd.attrs.added-date-cast',
    'date_rec_add',
    true,
    null,
    'an added date',
    'A parcel record added date that is not a date is treated as missing; a time of day is ' +
      'dropped'
  ),
  cast(
    attrs,
    'sd.attrs.dropped-date-cast',
    'date_rec_drop',
    true,
    null,
    'a dropped date',
    'A parcel record dropped date that is not a date is treated as missing; a time of day is ' +
      'dropped'
  ),
  // ---- Parcel attributes and height polygons (80_scenario.sql) ----
  // DQ-4 registered rules (final fix wave, review Important 1): the as-built drops and default of
  // 80_scenario.sql's parcel and height inputs. 0 live firings each on 2026-10-17 (236,573 parcel
  // rows: every one has a blklot and an active of true or false; 5,292 polygons, none blank).
  {
    ...SD,
    id: 'sd.attrs.active-unknown',
    source: attrs,
    field: 'active',
    kind: 'shape',
    action: 'default',
    tier: 4,
    valueTier: 4,
    maskBit: null,
    label:
      'A parcel record whose active flag is missing or not true or false is treated as retired',
    denominator: 'parcel rows',
    ...SHARES,
    unitsWeighted: false
  },
  // A drop of an unusable row, so `shape` (spec §4.12 "Default shares").
  {
    ...SD,
    id: 'sd.attrs.no-blklot',
    source: attrs,
    field: 'blklot',
    kind: 'shape',
    action: 'drop',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Parcel records without a lot number (blklot) are dropped, so no assessor row maps through ' +
      'them',
    denominator: 'parcel rows',
    ...SHARES,
    unitsWeighted: false
  },
  {
    ...SD,
    id: 'sd.height.blank',
    source: 'datasf-height-bulk',
    field: 'height',
    kind: 'shape',
    action: 'drop',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label: 'Height and bulk polygons without a height string are dropped and carry no district',
    denominator: 'height polygons',
    ...SHARES,
    unitsWeighted: false
  },
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
    // Counted on observed parcel-years only: a carried row (sd.roll.year-gap) copies the stories
    // and the bit of the year it is carried from.
    label:
      'Observed parcel-years without assessor stories take round(building height / 3.1 m), at ' +
      'least 1, when the building has a height',
    denominator: 'observed parcel-years',
    ...MISSING_SHARES,
    unitsWeighted: false
  },
  // Spec-stated behaviour, counted (final fix wave, review Important 1; observe · none, the 0.01
  // default): spec §4.5 step 3.1 "Else 0, which reads as 'no building' and sets no bit". It fires
  // where the parcel-year's rows have no stories at all (a source NULL, or nulled by
  // sd.roll.stories-max) and the chunk has no building height; a source 0 is the source's own value
  // and does not fire. 0 live firings on 2026-10-17 (all 65,117 zero-story parcel-years carry a
  // source 0).
  {
    ...SD,
    id: 'sd.features.no-building',
    source: 'sc_roll_agg',
    field: 'stories',
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Counts observed parcel-years with no assessor stories and no building height, which have ' +
      '0 stories ("no building"); changes nothing',
    denominator: 'observed parcel-years',
    ...SHARES,
    unitsWeighted: false
  },
  // Share override approved (partner, DQ-4, 2026-10-17): measured 4.28% of units live (141
  // parcel-years on 15 parcels, 312,058 of 7,293,490 units; 0.005% of rows); a few impossible
  // records carry thousands of units each (0827025, 0872002, 0715015 and 0306026 hold 248,442 of
  // them), so the units share sits far above the row share. Warn above 5%, fail above 10%.
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
    warnShare: 0.05,
    failShare: 0.1,
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
  // Share override approved (partner, DQ-4, 2026-10-17): measured 5.90% of rows live (172,322 of
  // 2,921,640); 146,421 of the 171,467 bit-6 panel rows have 0 units, mostly non-residential
  // parcel-years whose roll floor area is 0, so the routine 5% default warns on every build. Warn
  // above 7%, fail above 15%.
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
    denominator: 'panel parcel-years plus T11 no-row parcels',
    warnShare: 0.07,
    failShare: 0.15,
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
  // Share override approved (partner, DQ-4, 2026-10-17): measured 4.23% of hostable parcels live
  // (5,945 of 140,529); acdm-wktn writes the bare NCD/NCT code for the named
  // neighbourhood-commercial districts it does not name (ruling A9), so the share is a property of
  // the source. Warn above 5%; A9's escalation line, 10% of hostable parcels, still fails.
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
    warnShare: 0.05,
    failShare: 0.1,
    unitsWeighted: false
  },
  // Spec-stated behaviour, counted (final fix wave, review Important 1; observe · none, the 0.01
  // default): a missing zoning code reads as "anything else" in the density-cap table, so no cap
  // (spec §4.4, §4.6 "NULL if none"). densityCapRule calls it 'none': a NULL or blank code on the
  // chosen active acdm-wktn row, or no active row at all. 758 parcels live, every one with an
  // active row whose code is NULL; 2 of them hostable (2 of 140,529, 0.001%).
  {
    ...SD,
    id: 'sd.zoning.missing',
    source: 'datasf-parcel-attrs',
    field: 'zoning_code',
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'Counts hostable parcels with no zoning code, which have no density cap; changes nothing',
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
  // Share override approved (partner, DQ-4, 2026-10-17): measured 7.62% live (11,584 of 152,113),
  // as the design measured (11,585, RA1); an observation of the yield table that changes nothing,
  // known rather than a new shape. Warn above 9%, fail above 15%.
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
    warnShare: 0.09,
    failShare: 0.15,
    unitsWeighted: false
  }
];
