-- 81_scenario_features: the parcel-year data-quality rules and the per (current parcel, roll
-- year) T4a feature values with imputation: the T13 parcel panel minus its yield columns
-- (scenario-data spec §4.5 rule order steps 3 and 4, §4.6, §4.12). Run by
-- pipeline/steps/scenario-sql.ts after 80_scenario.sql and after it writes sc_parcel
-- (id, lot_area_m2, eligible, base_stories, cap_pre2022, cap_prefzp, ludb_units,
-- rec_floor_area_m2) and the variables floors_m, min_gross_m2_per_unit (MIN_GROSS_M2_PER_UNIT,
-- pipeline/lib/quality.ts) and density_cap_change_day (a Day, pipeline/lib/density-caps.ts).
-- Reads sc_roll_agg, sc_roll_years, sc_parcel, sc_zoning, sc_land_use_classes, parcel_out.
-- Writes sc_roll_series (observed parcel-years after the units rules, plus the carried rows),
-- sc_medians (roll_year, land_use_class, year_built, improvement_share) and sc_features.
-- T14: every rule below inserts exactly one quality_tally row and one quality_sample row per
-- affected record (`<mapblklot>:<roll_year>` for a parcel-year, `<mapblklot>` for a parcel);
-- runScenarioSql reports them through recordSqlQuality. Rule order (§4.5 step 3, then step 4):
--   1. existing stories (sd.features.stories-height);
--   2. sd.roll.units-capacity, on observed parcel-years;
--   3. sd.roll.units-spike, on the series step 2 produced;
--   4. sd.roll.year-gap: interior missing roll years carried from the previous observed year;
--   5. the observation rules sd.roll.units-latest-jump and sd.roll.units-large (change nothing);
--   then the features: medians over observed rows only (carried rows never feed them), the median
--   rules and their fallback, and sd.roll.floor-area-missing.

-- ---- Step 3.1: existing stories, on observed parcel-years ----
-- existingStories: roll stories, else round(height / floors_m) with floors_m = 3.1 m per storey
-- (SQL_VARS, the generator's FTF_M, tier 3), at least 1, when a height exists
-- (sd.features.stories-height, bit 1); else 0, "no building", no bit.
CREATE OR REPLACE TEMP TABLE f_obs AS
SELECT r.*,
       CASE WHEN r.stories > 0 THEN r.stories
            WHEN o.height_m > 0 THEN greatest(1, round(o.height_m / getvariable('floors_m')))
            ELSE 0 END::INTEGER AS existing_stories,
       (r.stories <= 0 AND o.height_m > 0) AS stories_fallback,
       s.lot_area_m2, s.ludb_units
FROM sc_roll_agg r
JOIN parcel_out o ON o.id = r.id
JOIN sc_parcel s ON s.id = r.id;

INSERT INTO quality_tally
SELECT 'sd.features.stories-height', count(*) FILTER (WHERE stories_fallback), count(*),
       NULL, NULL
FROM f_obs;
INSERT INTO quality_sample
SELECT 'sd.features.stories-height', id || ':' || roll_year FROM f_obs WHERE stories_fallback;

-- ---- Step 3.2: sd.roll.units-capacity (spec §4.12 "exactly") ----
-- capacity(p, y) = lot_area_m2 × max(existing_stories, 1) / MIN_GROSS_M2_PER_UNIT (10 m² per
-- home, tier 4, pipeline/lib/quality.ts). Compared in integers: units × 10 > area × stories, so a
-- parcel-year exactly at capacity passes and no float rounding decides a case.
CREATE OR REPLACE TEMP TABLE f_cap AS
SELECT *,
       lot_area_m2::BIGINT * greatest(existing_stories, 1) AS cap_area,
       units::BIGINT * getvariable('min_gross_m2_per_unit')
         > lot_area_m2::BIGINT * greatest(existing_stories, 1) AS cap_fail
FROM f_obs;

-- A failing parcel-year takes the first of: the units of the passing observed year nearest to it
-- (the earlier on a tie; carried rows do not exist yet); the chunk record's LUDB units if they
-- pass; floor(capacity).
CREATE OR REPLACE TEMP TABLE f_cap_near AS
SELECT f.id, f.roll_year, p.units
FROM f_cap f
JOIN f_cap p ON p.id = f.id AND NOT p.cap_fail
WHERE f.cap_fail
QUALIFY row_number() OVER (
  PARTITION BY f.id, f.roll_year ORDER BY abs(p.roll_year - f.roll_year), p.roll_year
) = 1;

CREATE OR REPLACE TEMP TABLE f_cap_fix AS
SELECT f.id, f.roll_year,
       coalesce(
         n.units,
         CASE WHEN f.ludb_units::BIGINT * getvariable('min_gross_m2_per_unit') <= f.cap_area
              THEN f.ludb_units END,
         f.cap_area // getvariable('min_gross_m2_per_unit')
       )::INTEGER AS units
FROM f_cap f
LEFT JOIN f_cap_near n ON n.id = f.id AND n.roll_year = f.roll_year
WHERE f.cap_fail;

-- The post-capacity series. noncondo_units is capped at the replacement, so the rent-control
-- exclusion (§4.4) cannot read the impossible value. units_raw keeps the aggregated units.
CREATE OR REPLACE TEMP TABLE f_post_cap AS
SELECT f.* EXCLUDE (cap_area, cap_fail) REPLACE (
         coalesce(x.units, f.units)::INTEGER AS units,
         CASE WHEN x.id IS NULL THEN f.noncondo_units
              ELSE least(f.noncondo_units, x.units) END::INTEGER AS noncondo_units),
       f.units AS units_raw,
       x.id IS NOT NULL AS cap_replaced
FROM f_cap f
LEFT JOIN f_cap_fix x ON x.id = f.id AND x.roll_year = f.roll_year;

-- fired: replaced parcel-years; units: Σ their original units; unitsOf: Σ the original units of
-- every observed parcel-year.
INSERT INTO quality_tally
SELECT 'sd.roll.units-capacity', count(*) FILTER (WHERE cap_replaced), count(*),
       coalesce(sum(units_raw) FILTER (WHERE cap_replaced), 0), coalesce(sum(units_raw), 0)
FROM f_post_cap;
INSERT INTO quality_sample
SELECT 'sd.roll.units-capacity', id || ':' || roll_year FROM f_post_cap WHERE cap_replaced;

-- ---- Step 3.3: sd.roll.units-spike (ruling A12, as built), on the post-capacity series ----
-- Over each parcel's units series by observed roll year, a maximal run of equal values v with a
-- bracketing observed year on both sides (the nearest years outside the run, units prev and
-- next), v >= 100 and v > 10 * max(1, prev, next) (tier 4, made up; coordinator ruling, Task 8
-- fix round 1) takes prev in every year of the run. Live example: 0827025 has 5 units except
-- 50,000 in 2022-2023. A one-sided change (redevelopment that stays) is never touched.
-- noncondo_units is left as is: a bracketed run is never the latest year, the only year the
-- Local Program exclusions read.
CREATE OR REPLACE TEMP TABLE f_units_seq AS
SELECT id, roll_year, units,
       sum(CASE WHEN lag_units IS DISTINCT FROM units THEN 1 ELSE 0 END) OVER (
         PARTITION BY id ORDER BY roll_year ROWS UNBOUNDED PRECEDING) AS run
FROM (SELECT id, roll_year, units,
             lag(units) OVER (PARTITION BY id ORDER BY roll_year) AS lag_units
      FROM f_post_cap);

CREATE OR REPLACE TEMP TABLE f_units_run AS
SELECT id, run, v,
       lag(v) OVER (PARTITION BY id ORDER BY run) AS prev,
       lead(v) OVER (PARTITION BY id ORDER BY run) AS next
FROM (SELECT id, run, any_value(units) AS v FROM f_units_seq GROUP BY id, run);

CREATE OR REPLACE TEMP TABLE f_spike_fix AS
SELECT q.id, q.roll_year, r.prev AS units
FROM f_units_seq q
JOIN f_units_run r USING (id, run)
WHERE r.prev IS NOT NULL AND r.next IS NOT NULL AND r.v >= 100
  AND r.v > 10 * greatest(1, r.prev, r.next);

-- fired: replaced parcel-years; units: Σ their post-capacity units; unitsOf: Σ the post-capacity
-- units of every observed parcel-year.
INSERT INTO quality_tally
SELECT 'sd.roll.units-spike', count(x.id), count(*),
       coalesce(sum(f.units) FILTER (WHERE x.id IS NOT NULL), 0), coalesce(sum(f.units), 0)
FROM f_post_cap f
LEFT JOIN f_spike_fix x ON x.id = f.id AND x.roll_year = f.roll_year;
INSERT INTO quality_sample
SELECT 'sd.roll.units-spike', id || ':' || roll_year FROM f_spike_fix;

-- The observed series after both units rules. units_replaced marks bit 3.
CREATE OR REPLACE TEMP TABLE f_post AS
SELECT f.* EXCLUDE (units_raw, cap_replaced)
           REPLACE (coalesce(x.units, f.units)::INTEGER AS units),
       f.cap_replaced OR x.id IS NOT NULL AS units_replaced,
       false AS carried
FROM f_post_cap f
LEFT JOIN f_spike_fix x ON x.id = f.id AND x.roll_year = f.roll_year;

-- ---- Step 3.4: sd.roll.year-gap (spec §4.12) ----
-- Every lock roll year strictly between a parcel's first and last observed years with no
-- observed row is carried: a copy of the post-rule row of the latest observed year before it
-- (units, stories, existing stories, raw year built, values, floor area, use code, class,
-- noncondo_units, hotel, status, units_replaced and the row-level rule flags), with its own
-- roll_year (and so its own lien_day and medians below), and bit 5. Years before the first or
-- after the last observed year are never carried.
CREATE OR REPLACE TEMP TABLE f_gap AS
SELECT s.id, y.roll_year
FROM (SELECT id, min(roll_year) AS lo, max(roll_year) AS hi FROM f_post GROUP BY id) s
JOIN sc_roll_years y ON y.roll_year > s.lo AND y.roll_year < s.hi
LEFT JOIN f_post e ON e.id = s.id AND e.roll_year = y.roll_year
WHERE e.id IS NULL;

CREATE OR REPLACE TEMP TABLE f_carried AS
SELECT o.* REPLACE (g.roll_year AS roll_year, true AS carried)
FROM f_gap g
JOIN f_post o ON o.id = g.id AND o.roll_year < g.roll_year
QUALIFY row_number() OVER (PARTITION BY g.id, g.roll_year ORDER BY o.roll_year DESC) = 1;

CREATE OR REPLACE TABLE sc_roll_series AS
SELECT * FROM (SELECT * FROM f_post UNION ALL BY NAME SELECT * FROM f_carried)
ORDER BY id, roll_year;

INSERT INTO quality_tally
SELECT 'sd.roll.year-gap', count(*) FILTER (WHERE carried), count(*), NULL, NULL
FROM sc_roll_series;
INSERT INTO quality_sample
SELECT 'sd.roll.year-gap', id || ':' || roll_year FROM sc_roll_series WHERE carried;

-- ---- Step 3.5: observation rules on the final series (tier 4, made up; RA1). They count ----
-- sd.roll.units-latest-jump: a parcel whose latest-roll-year units are >= 100 and more than 10×
-- its previous-roll-year row (observed or carried); of: parcels with a row in both years.
CREATE OR REPLACE TEMP TABLE f_jump AS
SELECT l.id, l.units >= 100 AND l.units > 10 * p.units AS fired
FROM sc_roll_series l
JOIN sc_roll_series p ON p.id = l.id
WHERE l.roll_year = (SELECT max(roll_year) FROM sc_roll_years)
  AND p.roll_year = (SELECT max(roll_year) FROM sc_roll_years
                     WHERE roll_year < (SELECT max(roll_year) FROM sc_roll_years));

INSERT INTO quality_tally
SELECT 'sd.roll.units-latest-jump', count(*) FILTER (WHERE fired), count(*), NULL, NULL
FROM f_jump;
INSERT INTO quality_sample
SELECT 'sd.roll.units-latest-jump', id FROM f_jump WHERE fired;

-- sd.roll.units-large: a panel parcel-year with more than 500 units that neither units rule
-- replaced (bit 3) and that was not carried (bit 5).
INSERT INTO quality_tally
SELECT 'sd.roll.units-large',
       count(*) FILTER (WHERE units > 500 AND NOT units_replaced AND NOT carried), count(*),
       NULL, NULL
FROM sc_roll_series;
INSERT INTO quality_sample
SELECT 'sd.roll.units-large', id || ':' || roll_year FROM sc_roll_series
WHERE units > 500 AND NOT units_replaced AND NOT carried;

-- ---- Step 4: features, on every panel parcel-year (observed and carried) ----
CREATE OR REPLACE TEMP TABLE f_base AS
SELECT r.*,
       r.land_use_class = (SELECT idx FROM sc_land_use_classes WHERE name = 'vacant') AS vacant,
       CASE WHEN r.land + r.impr > 0 THEN r.impr / (r.land + r.impr) END AS share_raw
FROM sc_roll_series r;

-- Medians over observed non-vacant rows with a value (carried rows never contribute; spec §4.5,
-- tier 2): per (year, class), and per year as the fallback for a class with no value that year
-- (sd.features.median-fallback, tier 4, made up, operator ruling, Task 7 fix round 1).
-- quantile_disc(x, 0.5) is an observed value, deterministic (spec §4.6 "Imputation basis").
CREATE OR REPLACE TEMP TABLE f_med_class AS
SELECT roll_year, land_use_class,
       quantile_disc(year_built, 0.5) AS year_built,
       quantile_disc(share_raw, 0.5) AS share_raw
FROM f_base WHERE NOT vacant AND NOT carried
GROUP BY roll_year, land_use_class;

CREATE OR REPLACE TEMP TABLE f_med_year AS
SELECT roll_year,
       quantile_disc(year_built, 0.5) AS year_built,
       quantile_disc(share_raw, 0.5) AS share_raw
FROM f_base WHERE NOT vacant AND NOT carried
GROUP BY roll_year;

-- One row per (lock roll year, class), final values: the median share rounded to 1/200 (a tier-4
-- quantisation grid, T11 spec §4.8); vacant 0 and 0 (spec §4.5). Fallback chain: class median,
-- else the year-wide non-vacant median, else 0. year_fallback / share_fallback mark a class with
-- no observed value that year.
CREATE OR REPLACE TEMP TABLE f_medians AS
SELECT y.roll_year, c.idx::INTEGER AS land_use_class,
       CASE WHEN c.name = 'vacant' THEN 0
            ELSE coalesce(mc.year_built, my.year_built, 0) END::INTEGER AS year_built,
       CASE WHEN c.name = 'vacant' THEN 0
            ELSE round(coalesce(mc.share_raw, my.share_raw, 0) * 200) / 200 END::FLOAT
         AS improvement_share,
       mc.year_built IS NULL AS year_fallback,
       mc.share_raw IS NULL AS share_fallback
FROM sc_roll_years y
CROSS JOIN sc_land_use_classes c
LEFT JOIN f_med_class mc ON mc.roll_year = y.roll_year AND mc.land_use_class = c.idx
LEFT JOIN f_med_year my ON my.roll_year = y.roll_year;

CREATE OR REPLACE TABLE sc_medians AS
SELECT roll_year, land_use_class, year_built, improvement_share FROM f_medians
ORDER BY roll_year, land_use_class;

-- Feature values and the T11/T13 mask flags (RA1 mask convention, §4.5 "Mask bits"):
-- bit 0 yearBuilt: imputed (NULL in the source, or a row nulled by sd.roll.year-built-range);
-- bit 1 existingStories: the height fallback, or a row nulled by sd.roll.stories-max;
-- bit 2 improvementShare imputed; bit 3 units replaced by a units rule (copied to carried rows);
-- bit 5 carried; bit 6 floor area from the chunk record. Bit 4 (no roll row) is the scenario
-- step's and never set here.
CREATE OR REPLACE TEMP TABLE f_feat AS
SELECT b.id, b.roll_year,
       -- T1 Day of 1 January roll_year: the CA lien date (spec §4.5, I).
       datediff('day', DATE '1970-01-01', make_date(b.roll_year, 1, 1))::INTEGER AS lien_day,
       b.units,
       b.existing_stories,
       b.stories_fallback OR b.stories_nulled AS stories_bit,
       CASE WHEN b.vacant THEN 0 ELSE coalesce(b.year_built, m.year_built) END::INTEGER
         AS year_built,
       (NOT b.vacant AND b.year_built IS NULL) AS year_imputed,
       -- A source NULL (sd.features.year-built-median), not a year the range rule nulled.
       (NOT b.vacant AND b.year_built IS NULL AND NOT b.year_nulled) AS year_median_rule,
       -- A nulled row whose siblings still carry a year changes the aggregate too.
       (NOT b.vacant AND (b.year_built IS NULL OR b.year_nulled)) AS year_bit,
       (NOT b.vacant AND b.year_built IS NULL AND m.year_fallback) AS year_fell_back,
       -- improvement ÷ (land + improvement), rounded to 1/200 (a tier-4 quantisation grid,
       -- T11 spec §4.8); vacant 0.
       CASE WHEN b.vacant THEN 0
            WHEN b.share_raw IS NOT NULL THEN round(b.share_raw * 200) / 200
            ELSE m.improvement_share END::FLOAT AS improvement_share,
       (NOT b.vacant AND b.share_raw IS NULL) AS share_imputed,
       (NOT b.vacant AND b.share_raw IS NULL AND m.share_fallback) AS share_fell_back,
       b.vacant,
       b.land, b.impr, b.use_code, b.land_use_class,
       -- existingFloorAreaM2 in whole m² (spec §4.5 step 4, RA1, IA-8): the roll's
       -- Σ property_area × 0.09290304 when > 0, else the chunk record's floor area
       -- (sd.roll.floor-area-missing, bit 6). Every yield and T11 use this rounded value, so the
       -- worker rebuilds the same record.
       round(CASE WHEN b.floor_area_m2 > 0 THEN b.floor_area_m2
                  ELSE s.rec_floor_area_m2 END)::INTEGER AS existing_floor_area_m2,
       NOT (b.floor_area_m2 > 0) AS floor_missing,
       b.noncondo_units, b.hotel, b.status_n, b.units_replaced, b.carried
FROM f_base b
JOIN sc_parcel s ON s.id = b.id
JOIN f_medians m ON m.roll_year = b.roll_year AND m.land_use_class = b.land_use_class;

INSERT INTO quality_tally
SELECT 'sd.features.year-built-median', count(*) FILTER (WHERE year_median_rule),
       count(*) FILTER (WHERE NOT vacant), NULL, NULL
FROM f_feat;
INSERT INTO quality_sample
SELECT 'sd.features.year-built-median', id || ':' || roll_year FROM f_feat WHERE year_median_rule;

INSERT INTO quality_tally
SELECT 'sd.features.share-median', count(*) FILTER (WHERE share_imputed),
       count(*) FILTER (WHERE NOT vacant), NULL, NULL
FROM f_feat;
INSERT INTO quality_sample
SELECT 'sd.features.share-median', id || ':' || roll_year FROM f_feat WHERE share_imputed;

-- of: every value a median imputed (a year, whether a source NULL or nulled by the range rule,
-- and a share); fired: those whose class had no observed value that year.
INSERT INTO quality_tally
SELECT 'sd.features.median-fallback',
       count(*) FILTER (WHERE year_fell_back) + count(*) FILTER (WHERE share_fell_back),
       count(*) FILTER (WHERE year_imputed) + count(*) FILTER (WHERE share_imputed), NULL, NULL
FROM f_feat;
INSERT INTO quality_sample
SELECT 'sd.features.median-fallback', id || ':' || roll_year FROM f_feat
WHERE year_fell_back OR share_fell_back;

INSERT INTO quality_tally
SELECT 'sd.roll.floor-area-missing', count(*) FILTER (WHERE floor_missing), count(*), NULL, NULL
FROM f_feat;
INSERT INTO quality_sample
SELECT 'sd.roll.floor-area-missing', id || ':' || roll_year FROM f_feat WHERE floor_missing;

CREATE OR REPLACE TABLE sc_features AS
SELECT f.id AS mapblklot,
       f.roll_year,
       f.lien_day,
       f.units AS existing_units,
       f.existing_stories,
       f.year_built,
       f.land AS land_value,
       f.impr AS improvement_value,
       f.use_code,
       f.land_use_class,
       z.zoning_code,
       s.base_stories,
       -- The base-zoning cap at min(lien_day, 2026-01-11) (spec §4.4 "Base cap date", RA1): base
       -- always means the zoning before the FZP, so a post-FZP roll year keeps the pre-FZP cap.
       CASE WHEN f.lien_day < getvariable('density_cap_change_day') THEN s.cap_pre2022
            ELSE s.cap_prefzp END AS base_density_cap,
       s.lot_area_m2,
       f.improvement_share,
       -- T4a verbatim: ≥ 2 units and built before 1979 (Rent Ordinance, pre-1979-06-13
       -- buildings, tier 2, I), on the post-rule units and the imputed year.
       (f.units >= 2 AND f.year_built < 1979) AS rent_control_likely,
       ((CASE WHEN f.year_bit THEN 1 ELSE 0 END)
        | (CASE WHEN f.stories_bit THEN 2 ELSE 0 END)
        | (CASE WHEN f.share_imputed THEN 4 ELSE 0 END)
        | (CASE WHEN f.units_replaced THEN 8 ELSE 0 END)
        | (CASE WHEN f.carried THEN 32 ELSE 0 END)
        | (CASE WHEN f.floor_missing THEN 64 ELSE 0 END))::UTINYINT AS imputed,
       f.existing_floor_area_m2,
       s.eligible,
       f.noncondo_units,
       f.hotel,
       f.status_n
FROM f_feat f
JOIN sc_parcel s ON s.id = f.id
LEFT JOIN sc_zoning z ON z.id = f.id
ORDER BY f.id, f.roll_year;
