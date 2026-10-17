// Scenario SQL stage (scenario-data spec §4.3–§4.6): height strings parsed in TS, the district
// join, lineage and roll aggregation in 80_scenario.sql, per-parcel density caps in TS, and the
// per-year features in 81_scenario_features.sql. Not part of SQL_FILES / runSql: the scenario
// build step calls it after writeChunks, with the records writeChunks encoded.
import path from 'node:path';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { LAND_USE_CLASSES } from '../../src/lib/data/scenario-codec';
import { MAX_STORIES } from '../../src/lib/generator/constants';
import { DENSITY_CAP_CHANGE_DAY, FZP_EFFECTIVE_DAY, densityCap } from '../lib/density-caps';
import { createTableFromRows, runSqlFile, type CellValue, type Duck } from '../lib/duck';
import {
  HeightParseError,
  normaliseHeight,
  parseHeightDistrict,
  storiesFromFt
} from '../lib/heights';

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

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
 * Step 3: per-parcel lot area, base stories and the base-zoning cap in each of the three cap
 * periods (main ruling C2), evaluated on one day inside each: the day before
 * DENSITY_CAP_CHANGE_DAY, the day before FZP_EFFECTIVE_DAY, and FZP_EFFECTIVE_DAY.
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
      rec.eligible,
      d.base_ft === null ? 0 : storiesFromFt(d.base_ft),
      cap(DENSITY_CAP_CHANGE_DAY - 1),
      cap(FZP_EFFECTIVE_DAY - 1),
      cap(FZP_EFFECTIVE_DAY)
    ];
  });
  await createTableFromRows(
    db,
    'sc_parcel',
    [
      ['id', 'VARCHAR'],
      ['lot_area_m2', 'INTEGER'],
      ['eligible', 'BOOLEAN'],
      ['base_stories', 'INTEGER'],
      ['cap_pre2022', 'INTEGER'],
      ['cap_prefzp', 'INTEGER'],
      ['cap_fzp', 'INTEGER']
    ],
    out
  );
}

/**
 * Run the scenario SQL stage on a database where runSql has run (parcels, parcel_out, src_*).
 * `records` are readParcelRecords' output. Writes sc_height_parse, sc_land_use_classes,
 * sc_district, sc_zoning, parcel_lineage, sc_roll_agg, sc_parcel, sc_medians and sc_features,
 * and scenario.* rows in report_counts. Returns the height strings that failed to parse (V16).
 */
export async function runScenarioSql(
  db: Duck,
  records: { rec: ParcelRecord; cellId: string }[]
): Promise<{ parseFailures: string[] }> {
  // Idempotent on one database: drop this stage's counts from an earlier run.
  await db.run(
    `DELETE FROM report_counts WHERE key LIKE 'scenario.height.%' OR key LIKE 'scenario.roll.%'`
  );
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
  // Roll stories above the generator's MAX_STORIES are missing (tier-4 sanity rule, 80_scenario).
  await db.run(`SET VARIABLE max_stories = ${MAX_STORIES}::INTEGER`);
  await runSqlFile(db, path.join(SQL_DIR, '80_scenario.sql'));
  await writeParcelCaps(db, records);
  await db.run(`SET VARIABLE density_cap_change_day = ${DENSITY_CAP_CHANGE_DAY}::INTEGER`);
  await db.run(`SET VARIABLE fzp_effective_day = ${FZP_EFFECTIVE_DAY}::INTEGER`);
  await runSqlFile(db, path.join(SQL_DIR, '81_scenario_features.sql'));
  const [{ agg, feat }] = await db.all<{ agg: number; feat: number }>(
    'SELECT (SELECT count(*) FROM sc_roll_agg) agg, (SELECT count(*) FROM sc_features) feat'
  );
  if (agg !== feat) {
    throw new Error(`runScenarioSql: ${agg} roll aggregates but ${feat} feature rows`);
  }
  return { parseFailures };
}
