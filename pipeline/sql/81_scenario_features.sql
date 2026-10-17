-- 81_scenario_features: per (current parcel, roll year) T4a feature values with imputation, the
-- T13 parcel panel minus its yield columns (scenario-data spec §4.5, §4.6). Run by
-- pipeline/steps/scenario-sql.ts after 80_scenario.sql and after it writes sc_parcel
-- (id, lot_area_m2, eligible, base_stories, cap_pre2022, cap_prefzp, cap_fzp) and the variables
-- density_cap_change_day and fzp_effective_day (Days, pipeline/lib/density-caps.ts).
-- Reads sc_roll_agg, sc_parcel, sc_zoning, sc_land_use_classes, parcel_out.
-- Writes sc_medians (roll_year, land_use_class, year_built, improvement_share) and sc_features.
-- Medians are quantile_disc(x, 0.5): an observed value, deterministic (spec §4.6 "Imputation
-- basis": per (land_use_class, roll_year) over the panel's own rows). Imputations are tier 2.

CREATE OR REPLACE TEMP TABLE f_base AS
SELECT r.*,
       r.land_use_class = (SELECT idx FROM sc_land_use_classes WHERE name = 'vacant') AS vacant,
       CASE WHEN r.land + r.impr > 0 THEN r.impr / (r.land + r.impr) END AS share_raw
FROM sc_roll_agg r;

-- Medians over non-vacant rows with a value: per (year, class), and per year as the fallback for
-- a class with no value that year (the spec's class median does not exist there; tier 2, I).
CREATE OR REPLACE TEMP TABLE f_med_class AS
SELECT roll_year, land_use_class,
       quantile_disc(year_built, 0.5) AS year_built,
       quantile_disc(share_raw, 0.5) AS share_raw
FROM f_base WHERE NOT vacant
GROUP BY roll_year, land_use_class;

CREATE OR REPLACE TEMP TABLE f_med_year AS
SELECT roll_year,
       quantile_disc(year_built, 0.5) AS year_built,
       quantile_disc(share_raw, 0.5) AS share_raw
FROM f_base WHERE NOT vacant
GROUP BY roll_year;

-- One row per (roll year, class), final values: the median share rounded to 1/200 (the T11
-- quantisation, spec §4.8); vacant 0 and 0 (spec §4.5); no value at all in a year gives 0.
CREATE OR REPLACE TABLE sc_medians AS
SELECT y.roll_year, c.idx::INTEGER AS land_use_class,
       CASE WHEN c.name = 'vacant' THEN 0
            ELSE coalesce(mc.year_built, my.year_built, 0) END::INTEGER AS year_built,
       CASE WHEN c.name = 'vacant' THEN 0
            ELSE round(coalesce(mc.share_raw, my.share_raw, 0) * 200) / 200 END::FLOAT
         AS improvement_share
FROM (SELECT DISTINCT roll_year FROM sc_roll_agg) y
CROSS JOIN sc_land_use_classes c
LEFT JOIN f_med_class mc ON mc.roll_year = y.roll_year AND mc.land_use_class = c.idx
LEFT JOIN f_med_year my ON my.roll_year = y.roll_year
ORDER BY y.roll_year, c.idx;

-- Feature values and imputed bits (T11 mask: bit 0 yearBuilt, 1 existingStories,
-- 2 improvementShare; bit 4, no roll row, is Task 8's and never set here).
CREATE OR REPLACE TEMP TABLE f_feat AS
SELECT b.id, b.roll_year,
       -- T1 Day of 1 January roll_year: the CA lien date (spec §4.5, I).
       datediff('day', DATE '1970-01-01', make_date(b.roll_year, 1, 1))::INTEGER AS lien_day,
       b.units,
       -- existingStories: roll stories, else round(height / floors_m) with floors_m = 3.1 m per
       -- storey (SQL_VARS, the generator's FTF_M, tier 3), at least 1, when a height exists.
       CASE WHEN b.stories > 0 THEN b.stories
            WHEN o.height_m > 0 THEN greatest(1, round(o.height_m / getvariable('floors_m')))
            ELSE 0 END::INTEGER AS existing_stories,
       (b.stories <= 0 AND o.height_m > 0) AS stories_imputed,
       CASE WHEN b.vacant THEN 0 ELSE coalesce(b.year_built, m.year_built) END::INTEGER
         AS year_built,
       (NOT b.vacant AND b.year_built IS NULL) AS year_imputed,
       -- improvement ÷ (land + improvement), rounded to 1/200 like T11; vacant 0.
       CASE WHEN b.vacant THEN 0
            WHEN b.share_raw IS NOT NULL THEN round(b.share_raw * 200) / 200
            ELSE m.improvement_share END::FLOAT AS improvement_share,
       (NOT b.vacant AND b.share_raw IS NULL) AS share_imputed,
       b.land, b.impr, b.use_code, b.land_use_class,
       CASE WHEN b.floor_area_m2 > 0 THEN b.floor_area_m2 ELSE o.floor_area_m2 END::DOUBLE
         AS existing_floor_area_m2,
       b.noncondo_units, b.hotel, b.status_n
FROM f_base b
JOIN parcel_out o ON o.id = b.id
JOIN sc_medians m ON m.roll_year = b.roll_year AND m.land_use_class = b.land_use_class;

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
       -- The base-zoning cap of the period containing lien_day (main ruling C2: three periods).
       CASE WHEN f.lien_day < getvariable('density_cap_change_day') THEN s.cap_pre2022
            WHEN f.lien_day < getvariable('fzp_effective_day') THEN s.cap_prefzp
            ELSE s.cap_fzp END AS base_density_cap,
       s.lot_area_m2,
       f.improvement_share,
       -- T4a verbatim: ≥ 2 units and built before 1979 (Rent Ordinance, pre-1979-06-13
       -- buildings, tier 2, I), on the imputed year.
       (f.units >= 2 AND f.year_built < 1979) AS rent_control_likely,
       ((CASE WHEN f.year_imputed THEN 1 ELSE 0 END)
        | (CASE WHEN f.stories_imputed THEN 2 ELSE 0 END)
        | (CASE WHEN f.share_imputed THEN 4 ELSE 0 END))::UTINYINT AS imputed,
       f.existing_floor_area_m2,
       s.eligible,
       f.noncondo_units,
       f.hotel,
       f.status_n
FROM f_feat f
JOIN sc_parcel s ON s.id = f.id
LEFT JOIN sc_zoning z ON z.id = f.id
ORDER BY f.id, f.roll_year;
