// Scenario SQL stage (scenario-data spec §4.3–§4.6): height strings parsed in TS, the district
// join, lineage and roll aggregation in 80_scenario.sql, per-parcel density caps in TS, and the
// per-year data-quality rules and features in 81_scenario_features.sql. Not part of SQL_FILES /
// runSql: the scenario build step calls it after writeChunks, with the records writeChunks
// encoded. The SQL-side T14 rules (spec §4.12) tally into quality_tally / quality_sample; the
// scenario step (writeScenario) reports them through recordSqlQuality after the T11 rows, into the
// build's single `counts` object.
import path from 'node:path';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { LAND_USE_CLASSES } from '../../src/lib/data/scenario-codec';
import { MAX_STORIES } from '../../src/lib/generator/constants';
import { DENSITY_CAP_CHANGE_DAY, FZP_EFFECTIVE_DAY, densityCap } from '../lib/density-caps';
import { createTableFromRows, runSqlFile, type CellValue, type Duck } from '../lib/duck';
import { MIN_GROSS_M2_PER_UNIT } from '../lib/quality';
import {
  HeightParseError,
  normaliseHeight,
  parseHeightDistrict,
  storiesFromFt
} from '../lib/heights';

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

/**
 * The T14 rules 80_scenario.sql and 81_scenario_features.sql apply and tally (spec §4.12, the DQ-4
 * registered rules sd.roll.no-year and sd.roll.units-missing, and the final fix wave's: the
 * normalise casts, which normalise flags in cast_flags, the attrs and height drops and default,
 * and the sd.features.no-building and vacant-lot observations). Each inserts exactly one
 * quality_tally row per run.
 */
export const SCENARIO_SQL_RULES = [
  'sd.attrs.active-unknown',
  'sd.attrs.added-date-cast',
  'sd.attrs.dropped-date-cast',
  'sd.attrs.latitude-cast',
  'sd.attrs.longitude-cast',
  'sd.attrs.no-blklot',
  'sd.features.median-fallback',
  'sd.features.no-building',
  'sd.features.share-median',
  'sd.features.stories-height',
  'sd.features.vacant-share',
  'sd.features.vacant-year-built',
  'sd.features.year-built-median',
  'sd.height.blank',
  'sd.roll.floor-area-cast',
  'sd.roll.floor-area-missing',
  'sd.roll.improvement-value-cast',
  'sd.roll.land-value-cast',
  'sd.roll.no-year',
  'sd.roll.roll-year-cast',
  'sd.roll.stories-cast',
  'sd.roll.stories-max',
  'sd.roll.unmatched',
  'sd.roll.units-capacity',
  'sd.roll.units-cast',
  'sd.roll.units-large',
  'sd.roll.units-latest-jump',
  'sd.roll.units-missing',
  'sd.roll.units-spike',
  'sd.roll.year-built-cast',
  'sd.roll.year-built-range',
  'sd.roll.year-gap'
] as const;

/** sc_height_parse row for a string with no height (sentinel or parse failure). */
const noneRow = (height: string): CellValue[] => [
  height,
  normaliseHeight(height),
  'none',
  null,
  null,
  false
];

/** Step 1: one parsed row per distinct height string; failures are kind none and returned. */
async function writeHeightParse(db: Duck): Promise<string[]> {
  const heights = await db.all<{ height: string }>(
    `SELECT DISTINCT coalesce(height, '') AS height FROM src_height_bulk ORDER BY height`
  );
  const failures: string[] = [];
  const rows = heights.map(({ height }): CellValue[] => {
    try {
      const d = parseHeightDistrict(height);
      if (d.kind === 'none') return noneRow(height);
      return [height, d.normalised, 'height', d.baseFt, d.lpFt, d.r4];
    } catch (e) {
      if (!(e instanceof HeightParseError)) throw e;
      failures.push(height);
      return noneRow(height);
    }
  });
  await createTableFromRows(
    db,
    'sc_height_parse',
    [
      ['height', 'VARCHAR'],
      ['normalised', 'VARCHAR'],
      ['kind', 'VARCHAR'],
      ['base_ft', 'INTEGER'],
      ['lp_ft', 'INTEGER'],
      ['r4', 'BOOLEAN']
    ],
    rows
  );
  return failures;
}

/**
 * Step 3: per-parcel lot area, base stories, the base-zoning cap and the chunk record's LUDB units
 * and floor area. The panel's base cap is the cap at min(lien_day, 2026-01-11) (spec §4.4 "Base
 * cap date", RA1), so only two of the three cap periods (main ruling C2) are needed, each
 * evaluated on its last day: the day before DENSITY_CAP_CHANGE_DAY and the day before
 * FZP_EFFECTIVE_DAY. T11's FZP cap is the scenario step's (densityCap at capDay). `ludb_units`
 * feeds sd.roll.units-capacity's second step and `rec_floor_area_m2` sd.roll.floor-area-missing.
 * Eligibility is not stored here: the scenario step derives it per parcel-year from the chunk
 * record and the units (pipeline/lib/scenario-eligibility.ts, sd.landuse.none-with-units).
 */
async function writeParcelCaps(
  db: Duck,
  records: { rec: ParcelRecord; cellId: string }[]
): Promise<void> {
  const rows = await db.all<{
    id: string;
    base_ft: number | null;
    r4: boolean;
    zoning_code: string | null;
  }>('SELECT d.id, d.base_ft, d.r4, z.zoning_code FROM sc_district d JOIN sc_zoning z USING (id)');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = records.map(({ rec }): CellValue[] => {
    const d = byId.get(rec.id);
    if (!d) throw new Error(`runScenarioSql: parcel ${rec.id} has no sc_district row`);
    // Tier 0 geometry (spec §4.5: the roll's lot_area repeats on condo rows).
    const lotAreaM2 = Math.round(rec.areaM2);
    const cap = (day: number) => densityCap(d.zoning_code, lotAreaM2, d.r4, day);
    return [
      rec.id,
      lotAreaM2,
      d.base_ft === null ? 0 : storiesFromFt(d.base_ft),
      cap(DENSITY_CAP_CHANGE_DAY - 1),
      cap(FZP_EFFECTIVE_DAY - 1),
      rec.existingUnits,
      rec.existingFloorAreaM2
    ];
  });
  await createTableFromRows(
    db,
    'sc_parcel',
    [
      ['id', 'VARCHAR'],
      ['lot_area_m2', 'INTEGER'],
      ['base_stories', 'INTEGER'],
      ['cap_pre2022', 'INTEGER'],
      ['cap_prefzp', 'INTEGER'],
      ['ludb_units', 'INTEGER'],
      ['rec_floor_area_m2', 'DOUBLE']
    ],
    out
  );
}

/**
 * Run the scenario SQL stage on a database where runSql has run (parcels, parcel_out, src_*) and
 * `createQualityTables` has created quality_tally / quality_sample. `records` are
 * readParcelRecords' output. Writes sc_height_parse, sc_land_use_classes, sc_district, sc_zoning,
 * parcel_lineage, sc_roll_years, sc_roll_agg, sc_parcel, sc_roll_series, sc_medians and
 * sc_features, and scenario.* rows in report_counts. Leaves exactly one quality_tally row per
 * rule of SCENARIO_SQL_RULES (and its quality_sample rows) for the caller to report once
 * (writeScenario, after the T11 rows). Returns the height strings that failed to parse (V16).
 */
export async function runScenarioSql(
  db: Duck,
  records: { rec: ParcelRecord; cellId: string }[]
): Promise<{ parseFailures: string[] }> {
  // Idempotent on one database: drop this stage's counts and tallies from an earlier run.
  await db.run(
    `DELETE FROM report_counts WHERE key LIKE 'scenario.height.%' OR key LIKE 'scenario.roll.%'`
  );
  const ruleList = SCENARIO_SQL_RULES.map((id) => `'${id}'`).join(', ');
  await db.run(`DELETE FROM quality_tally WHERE rule_id IN (${ruleList})`);
  await db.run(`DELETE FROM quality_sample WHERE rule_id IN (${ruleList})`);
  const parseFailures = await writeHeightParse(db);
  await db.run(
    `INSERT INTO report_counts VALUES ('scenario.height.parse_fail', ${parseFailures.length})`
  );
  await createTableFromRows(
    db,
    'sc_land_use_classes',
    [
      ['idx', 'INTEGER'],
      ['name', 'VARCHAR']
    ],
    LAND_USE_CLASSES.map((name, idx) => [idx, name])
  );
  // sd.roll.stories-max: roll stories above the generator's MAX_STORIES are nulled (80_scenario).
  await db.run(`SET VARIABLE max_stories = ${MAX_STORIES}::INTEGER`);
  await runSqlFile(db, path.join(SQL_DIR, '80_scenario.sql'));
  await writeParcelCaps(db, records);
  await db.run(`SET VARIABLE density_cap_change_day = ${DENSITY_CAP_CHANGE_DAY}::INTEGER`);
  // sd.roll.units-capacity: 10 m² of lot area × stories per home (tier 4, pipeline/lib/quality.ts).
  await db.run(`SET VARIABLE min_gross_m2_per_unit = ${MIN_GROSS_M2_PER_UNIT}::INTEGER`);
  await runSqlFile(db, path.join(SQL_DIR, '81_scenario_features.sql'));
  const [{ agg, carried, feat }] = await db.all<{ agg: number; carried: number; feat: number }>(
    `SELECT (SELECT count(*) FROM sc_roll_agg) agg,
            (SELECT count(*) FROM sc_roll_series WHERE carried) carried,
            (SELECT count(*) FROM sc_features) feat`
  );
  if (agg + carried !== feat) {
    throw new Error(
      `runScenarioSql: ${agg} roll aggregates and ${carried} carried rows but ${feat} feature rows`
    );
  }
  // Every SQL rule tallies exactly once (spec §4.12); recordQuality rejects a second report.
  const tallies = await db.all<{ rule_id: string; n: number }>(
    `SELECT rule_id, count(*)::INTEGER n FROM quality_tally WHERE rule_id IN (${ruleList})
     GROUP BY rule_id`
  );
  const n = new Map(tallies.map((t) => [t.rule_id, t.n]));
  const bad = SCENARIO_SQL_RULES.filter((id) => n.get(id) !== 1);
  if (bad.length > 0) {
    throw new Error(`runScenarioSql: rules without exactly one tally row: ${bad.join(', ')}`);
  }
  return { parseFailures };
}
