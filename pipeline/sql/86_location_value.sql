-- 86_location_value: the location value index per lot (building-choice plan, Task 6; spec,
-- "locationValue per lot"). Run by pipeline/lib/location-value.ts after the scenario SQL, on a
-- database with parcels (10_parcels.sql) and sc_roll_agg (80_scenario.sql: one row per current
-- parcel and roll year, condo units summed). The wrapper sets location_value_min_year and
-- location_value_shrink. Writes lv_building, lv_nhood and lv_lot, and the locationValue.* counts.

-- A building: a parcel whose roll shows homes built in or after the minimum year, on its first
-- roll after the completion year (the roll of the completion year can assess a part-built
-- building; the next lien date, 1 January, assesses it complete, at market value). Hotels and
-- non-taxable parcels (status N) are left out: their assessed values are not a home's market
-- value. Value per home = (land + improvement) / units.
CREATE OR REPLACE TABLE lv_building AS
WITH new_rows AS (
  SELECT id, roll_year, (land + impr) / units AS per_home
  FROM sc_roll_agg
  WHERE year_built >= getvariable('location_value_min_year')
    AND roll_year > year_built
    AND units >= 1
    AND land + impr > 0
    AND NOT hotel
    AND NOT status_n
),
first_rolls AS (
  SELECT * FROM new_rows
  QUALIFY row_number() OVER (PARTITION BY id ORDER BY roll_year) = 1
)
-- The index: value per home over the median of the buildings first assessed in the same roll
-- year, so the year's prices drop out and the citywide figure is 1.
SELECT id, roll_year, per_home, per_home / median(per_home) OVER (PARTITION BY roll_year) AS idx
FROM first_rolls;

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
INSERT INTO report_counts SELECT 'locationValue.neighborhoods', count(*) FROM lv_nhood;
INSERT INTO report_counts
SELECT 'locationValue.thin', count(*) FROM lv_nhood
WHERE n < getvariable('location_value_shrink');
