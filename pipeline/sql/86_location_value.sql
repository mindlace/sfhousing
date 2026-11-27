-- 86_location_value: the location value index per lot (building-choice plan, Task 6; spec,
-- "locationValue per lot"). Run by pipeline/lib/location-value.ts after the scenario SQL, on a
-- database with parcels (10_parcels.sql) and sc_roll_agg (80_scenario.sql: one row per current
-- parcel and roll year, condo units summed). The wrapper sets the location_value_* variables.
-- Writes lv_building, lv_nhood and lv_lot, and the locationValue.* counts.

-- A building: a parcel whose roll shows at least location_value_min_homes homes built in or
-- after location_value_min_year, on its first roll after the completion year (the roll of the
-- completion year can assess a part-built building; the next lien date, 1 January, assesses it
-- complete, at market value). Hotels, non-taxable parcels (status N) and parcels with no assessed
-- value are left out: their assessed values are not a home's market value. Its value is
-- (land + improvement) per m² of floor area (the roll's property_area, summed): unit sizes differ
-- by neighbourhood, and an option's homes already carry its size. A building with no floor area
-- is counted (locationValue.no_area) and left out.
CREATE OR REPLACE TEMP TABLE lv_candidate AS
WITH new_rows AS (
  SELECT id, roll_year, floor_area_m2, (land + impr) / nullif(floor_area_m2, 0) AS per_m2
  FROM sc_roll_agg
  WHERE year_built >= getvariable('location_value_min_year')
    AND roll_year > year_built
    AND units >= getvariable('location_value_min_homes')
    AND land + impr > 0
    AND NOT hotel
    AND NOT status_n
)
SELECT * FROM new_rows
QUALIFY row_number() OVER (PARTITION BY id ORDER BY roll_year) = 1;

-- The reference per roll year: the median value per m² of the buildings first assessed that year;
-- a year with fewer than location_value_pool_min_n of them pools the years on either side (a
-- 3-year window centred on it). Dividing by it drops prices over time and puts the citywide
-- figure at 1.
CREATE OR REPLACE TEMP TABLE lv_reference AS
WITH b AS (SELECT * FROM lv_candidate WHERE per_m2 IS NOT NULL),
years AS (SELECT roll_year, count(*) AS n FROM b GROUP BY roll_year)
SELECT y.roll_year, median(b.per_m2) AS ref
FROM years y
JOIN b ON CASE WHEN y.n < getvariable('location_value_pool_min_n')
               THEN b.roll_year BETWEEN y.roll_year - 1 AND y.roll_year + 1
               ELSE b.roll_year = y.roll_year END
GROUP BY y.roll_year;

CREATE OR REPLACE TABLE lv_building AS
SELECT c.id, c.roll_year, c.per_m2, c.per_m2 / r.ref AS idx
FROM lv_candidate c
JOIN lv_reference r USING (roll_year)
WHERE c.per_m2 IS NOT NULL;

-- Per Analysis Neighborhood (parcels.neighborhood): n buildings, raw = their median index (1 with
-- none), shrunk = (n × raw + k) / (n + k), k = location_value_shrink.
CREATE OR REPLACE TABLE lv_nhood AS
WITH areas AS (
  SELECT DISTINCT neighborhood AS nhood FROM parcels WHERE neighborhood IS NOT NULL
),
stats AS (
  SELECT p.neighborhood AS nhood, count(*) AS n, median(b.idx) AS raw
  FROM lv_building b JOIN parcels p USING (id)
  WHERE p.neighborhood IS NOT NULL
  GROUP BY p.neighborhood
)
SELECT a.nhood,
       coalesce(s.n, 0)::INTEGER AS n,
       coalesce(s.raw, 1)::DOUBLE AS raw,
       ((coalesce(s.n, 0) * coalesce(s.raw, 1) + getvariable('location_value_shrink'))
         / (coalesce(s.n, 0) + getvariable('location_value_shrink')))::DOUBLE AS shrunk
FROM areas a
LEFT JOIN stats s USING (nhood)
ORDER BY a.nhood;

-- Every lot takes its neighbourhood's value; a lot with no neighbourhood takes 1.
CREATE OR REPLACE TABLE lv_lot AS
SELECT p.id, coalesce(n.shrunk, 1)::DOUBLE AS location_value
FROM parcels p
LEFT JOIN lv_nhood n ON n.nhood = p.neighborhood
ORDER BY p.id;

-- locationValue.thin: neighbourhoods where the buildings weigh less than the shrinkage (n < k).
DELETE FROM report_counts WHERE key LIKE 'locationValue.%';
INSERT INTO report_counts SELECT 'locationValue.buildings', count(*) FROM lv_building;
INSERT INTO report_counts
SELECT 'locationValue.no_area', count(*) FROM lv_candidate WHERE per_m2 IS NULL;
INSERT INTO report_counts SELECT 'locationValue.neighborhoods', count(*) FROM lv_nhood;
INSERT INTO report_counts
SELECT 'locationValue.thin', count(*) FROM lv_nhood
WHERE n < getvariable('location_value_shrink');
