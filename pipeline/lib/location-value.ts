import path from 'node:path';
import type { Provenance } from '../../src/lib/timelapse/types';
import { runSqlFile, type Duck } from './duck';
import { datasf } from './fzp-cal/provenance';

/**
 * The location value index (building-choice plan, Task 6; spec, "locationValue per lot"): how
 * much a new home's floor area is worth on a lot against the citywide figure. The choice's `choiceValue`
 * scales the Controller's value per home by it.
 */
export const LOCATION_VALUE = {
  /** Buildings completed in or after this year (owner decision, spec). */
  minYearBuilt: 2015,
  /**
   * Buildings of at least this many homes (coordinator ruling, Task 6): a multi-home developer
   * does not sell single-family homes, whose values per m² set the high end otherwise.
   */
  minHomes: 5,
  /**
   * A roll year with fewer new buildings than this takes its reference median over the 3-year
   * window centred on it (coordinator ruling, Task 6).
   */
  poolMinN: 10,
  /**
   * Shrinkage to 1: a neighbourhood's median index weighs n ÷ (n + shrink). Tier 4, invented:
   * it keeps an area with a few new buildings near the citywide figure, without a cliff.
   */
  shrink: 10
} as const;

export interface LocationValueByLot {
  /** Per lot id (parcels.id): its neighbourhood's shrunk index; 1 with no neighbourhood. */
  locationValue: Map<string, number>;
  /** Per Analysis Neighborhood, by name: buildings, median index (1 with none) and shrunk value. */
  byNeighborhood: { nhood: string; n: number; raw: number; shrunk: number }[];
  provenance: Provenance;
}

const SQL = path.resolve(import.meta.dirname, '../sql/86_location_value.sql');

/**
 * Runs 86_location_value.sql on a database with `parcels` and `sc_roll_agg` (after the scenario
 * SQL) and `report_counts`, and reads its tables. Every parcel gets a value.
 */
export async function locationValueByLot(db: Duck): Promise<LocationValueByLot> {
  const { minYearBuilt, minHomes, poolMinN, shrink } = LOCATION_VALUE;
  await db.run(`SET VARIABLE location_value_min_year = ${minYearBuilt}`);
  await db.run(`SET VARIABLE location_value_min_homes = ${minHomes}`);
  await db.run(`SET VARIABLE location_value_pool_min_n = ${poolMinN}`);
  await db.run(`SET VARIABLE location_value_shrink = CAST('${shrink}' AS DOUBLE)`);
  await runSqlFile(db, SQL);
  const [lots, byNeighborhood, [b]] = await Promise.all([
    db.all<{ id: string; location_value: number }>('SELECT id, location_value FROM lv_lot'),
    db.all<{ nhood: string; n: number; raw: number; shrunk: number }>(
      'SELECT nhood, n, raw, shrunk FROM lv_nhood ORDER BY nhood'
    ),
    db.all<{ n: number; first: number | null; last: number | null }>(
      'SELECT count(*) AS n, min(roll_year) AS first, max(roll_year) AS last FROM lv_building'
    )
  ]);
  const provenance: Provenance = {
    tier: 2,
    label:
      `Location value: assessed value per m² of buildings of ${minHomes} or more homes completed ` +
      `${minYearBuilt} on, ÷ the roll year's median (3-year window under ${poolMinN} buildings; ` +
      `data tier 0, index tier 2); neighbourhood median shrunk to 1 by n ÷ (n + ${shrink}), ` +
      `the ${shrink} invented (tier 4)`,
    sources: [
      datasf('assessorRoll'),
      { label: 'DataSF Analysis Neighborhoods (j2bu-swwd)', url: 'https://data.sf.gov/d/j2bu-swwd' }
    ],
    method:
      'Per building, its first roll after the completion year: (land + improvement) ÷ floor ' +
      'area (property_area), over the median of the buildings first assessed that roll year ' +
      '(pooled with the years either side when it has few). Per Analysis Neighborhood, the ' +
      'median index, shrunk to 1. Every lot takes its neighbourhood value.',
    n: b.n,
    ...(b.first === null || b.last === null
      ? {}
      : { window: [`${b.first}-01-01`, `${b.last}-01-01`] as [string, string] })
  };
  return {
    locationValue: new Map(lots.map((r) => [r.id, r.location_value])),
    byNeighborhood,
    provenance
  };
}
