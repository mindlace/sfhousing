import { MAX_STORIES } from '../../src/lib/generator/constants';
import type { Duck } from './duck';

/**
 * Ground coverage of tall new buildings, the evidence for the generator's `BLOCK_COVERAGE`
 * (building-choice plan, Task 2). Per lot: the DataSF building footprints (ynuv-fyni,
 * `src_footprints`) whose point on surface falls in the lot, unioned, over the lot's area. The lot
 * is the map block lot of the assessor roll's parcels (wv5m-vpq2, `src_roll`, latest roll year),
 * joined through `src_parcels` (condo units share one map block lot).
 */
export const BLOCK_FIT = {
  /** Lots with a roll row of at least this many stories. */
  minStories: 13,
  /** Built in or after this year. */
  minYear: 2005,
  /**
   * Built in or before this year: the footprints are the 2016 LiDAR capture (`sf16_bldgid`), so
   * a later building is missing or shows the old footprint.
   */
  footprintYear: 2016
} as const;

export interface BlockCoverageFit {
  /** Median footprint area ÷ lot area; null when no lot qualifies. */
  median: number | null;
  n: number;
}

/** The per-lot rows behind the fit: lot, stories, year built, lot and footprint areas (m²). */
export function blockCoverageSql(): string {
  const { minStories, minYear, footprintYear } = BLOCK_FIT;
  const to7131 = (g: string) => `ST_Transform(${g}, 'EPSG:4326', 'EPSG:7131', always_xy := true)`;
  // Roll stories above the generator's MAX_STORIES are entry errors (the roll has 999), as in
  // 80_scenario.sql's sd.roll.stories-max.
  return `
WITH tall AS (
  SELECT p.mapblklot, max(r.number_of_stories) AS stories, min(r.year_property_built) AS built
  FROM src_roll r JOIN src_parcels p ON p.blklot = r.parcel_number
  WHERE r.closed_roll_year = (SELECT max(closed_roll_year) FROM src_roll)
    AND r.number_of_stories BETWEEN ${minStories} AND ${MAX_STORIES}
    AND r.year_property_built BETWEEN ${minYear} AND ${footprintYear}
  GROUP BY p.mapblklot
),
lot AS (
  SELECT p.mapblklot, ST_Union_Agg(${to7131('p.geom')}) AS geom
  FROM src_parcels p JOIN tall USING (mapblklot)
  WHERE p.active
  GROUP BY p.mapblklot
),
fp AS (
  SELECT l.mapblklot, ST_Area(ST_Union_Agg(f.geom)) AS area
  FROM lot l
  JOIN (SELECT ${to7131('geom')} AS geom FROM src_footprints) f
    ON ST_Within(ST_PointOnSurface(f.geom), l.geom)
  GROUP BY l.mapblklot
)
SELECT tall.mapblklot, tall.stories, tall.built, ST_Area(lot.geom) AS lot_m2, fp.area AS footprint_m2
FROM tall JOIN lot USING (mapblklot) JOIN fp USING (mapblklot)
ORDER BY tall.mapblklot`;
}

/** Reads `src_roll`, `src_parcels` and `src_footprints` (normalised, EPSG:4326 geometry). */
export async function fitBlockCoverage(db: Duck): Promise<BlockCoverageFit> {
  const [r] = await db.all<{ median: number | null; n: number }>(
    `SELECT median(footprint_m2 / lot_m2) AS median, count(*) AS n FROM (${blockCoverageSql()})`
  );
  return { median: r.median, n: r.n };
}
