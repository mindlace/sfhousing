-- 80_scenario: parcel <-> height district join, zoning, retired-parcel lineage and the assessor
-- roll aggregated per (current parcel, roll year). Scenario-data spec §4.3, §4.4, §4.5.
-- Run by pipeline/steps/scenario-sql.ts (not by runSql), after the main SQL files.
-- Reads parcels, parcel_out, src_height_bulk, src_parcel_attrs, src_roll, and two tables the TS
-- step writes first: sc_height_parse (one parsed row per distinct height string) and
-- sc_land_use_classes (idx, name: LAND_USE_CLASSES of src/lib/data/scenario-codec.ts).
-- Writes sc_district, sc_zoning, parcel_lineage, sc_roll_agg and scenario.height.* /
-- scenario.roll.* counts. Every float sum is taken over an ordered list (list_sum), as in
-- 60_attributes.sql, so the result does not depend on thread scheduling (V12).
-- District overlap is summed per normalised height string, not per polygon: adjacent polygons
-- carrying the same string are one district, so a parcel straddling their shared edge is not
-- split between them. overlap_frac is clamped to at most 1; a raw sum above 1.0001 (overlapping
-- same-string polygons) is counted in scenario.height.overlap_gt1.

-- Height polygons in EPSG:7131 (as 10_parcels.sql:6) with their parsed string. A polygon with no
-- string (normalised '') carries no district and is left out.
CREATE OR REPLACE TEMP TABLE s_hb AS
SELECT h.hid, p.normalised, h.geom
FROM (
  SELECT row_number() OVER (ORDER BY height, gen_hght, ST_AsHEXWKB(geom)) AS hid,
         coalesce(height, '') AS height,
         ST_Transform(ST_MakeValid(geom::GEOMETRY), 'EPSG:4326', 'EPSG:7131',
                      always_xy := true) AS geom
  FROM src_height_bulk
) h
JOIN sc_height_parse p USING (height)
WHERE p.normalised <> '';

-- The parse of a normalised string (parseHeightDistrict depends on the normalised form only).
CREATE OR REPLACE TEMP TABLE s_hp AS
SELECT DISTINCT normalised, kind, base_ft, lp_ft, r4 FROM sc_height_parse WHERE normalised <> '';

-- Overlap area per (parcel, district string): polygons sharing a string are one district.
CREATE OR REPLACE TEMP TABLE s_ov AS
SELECT p.id, h.normalised,
       list_sum(list(ST_Area(ST_Intersection(p.geom, h.geom)) ORDER BY h.hid)) AS ov,
       bool_or(ST_Contains(h.geom, ST_Point(p.x0, p.y0))) AS has_label
FROM parcels p
JOIN s_hb h ON ST_Intersects(p.geom, h.geom)
GROUP BY p.id, h.normalised;

-- Spec §4.3: the largest overlap wins. Overlaps within 0.01 m² of the largest are ties (tier 4,
-- a numerical tolerance), broken by the district containing the label point, then by the smaller
-- normalised string. A zero-area touch is no overlap.
CREATE OR REPLACE TEMP TABLE s_win AS
SELECT id, normalised, ov FROM (
  SELECT *, max(ov) OVER (PARTITION BY id) AS ov_max FROM s_ov WHERE ov > 0
)
QUALIFY row_number() OVER (
  PARTITION BY id ORDER BY (ov >= ov_max - 0.01) DESC, has_label DESC, normalised
) = 1;

-- Winning overlap as a fraction of the parcel area, before clamping (0 when no overlap or a
-- degenerate parcel).
CREATE OR REPLACE TEMP TABLE s_frac AS
SELECT p.id, w.normalised,
       CASE WHEN w.id IS NULL OR ST_Area(p.geom) <= 0 THEN 0.0
            ELSE w.ov / ST_Area(p.geom) END::DOUBLE AS raw_frac
FROM parcels p
LEFT JOIN s_win w USING (id);

-- Every parcel. No overlap -> district '' and kind none. `split` when the winning overlap is
-- under 90% of the parcel area (spec §4.3; a reporting threshold only, orchestrator, tier 4).
CREATE OR REPLACE TABLE sc_district AS
SELECT f.id,
       coalesce(f.normalised, '') AS district,
       coalesce(h.kind, 'none') AS kind,
       h.base_ft::INTEGER AS base_ft,
       h.lp_ft::INTEGER AS lp_ft,
       coalesce(h.r4, false) AS r4,
       least(1.0, f.raw_frac)::DOUBLE AS overlap_frac,
       (f.normalised IS NOT NULL AND f.raw_frac < 0.9) AS split
FROM s_frac f
LEFT JOIN s_hp h ON h.normalised = f.normalised
ORDER BY f.id;

-- Zoning of the parcel's chosen active acdm-wktn row, picked like 10_parcels.sql:13
-- (blklot = mapblklot first, else the smallest blklot). NULL when the parcel has no attrs row.
CREATE OR REPLACE TABLE sc_zoning AS
SELECT p.id, z.zoning_code
FROM parcels p
LEFT JOIN (
  SELECT mapblklot, zoning_code FROM src_parcel_attrs
  WHERE active AND mapblklot IS NOT NULL
  QUALIFY row_number() OVER (
    PARTITION BY mapblklot ORDER BY (blklot = mapblklot) DESC, blklot, zoning_code
  ) = 1
) z ON z.mapblklot = p.id
ORDER BY p.id;

-- Roll parcel_number = acdm-wktn blklot (spec §4.5). Attrs rows with a blklot, centroid in 7131.
CREATE OR REPLACE TEMP TABLE s_attr AS
SELECT mapblklot, blklot, coalesce(active, false) AS active, date_rec_drop,
       CASE WHEN centroid_longitude IS NOT NULL AND centroid_latitude IS NOT NULL THEN
         ST_Transform(ST_Point(centroid_longitude, centroid_latitude), 'EPSG:4326', 'EPSG:7131',
                      always_xy := true)
       END AS c
FROM src_parcel_attrs
WHERE blklot IS NOT NULL;

-- (a) Any attrs row of the blklot whose mapblklot is a current parcel: the smallest such id.
-- Condo sub-lots map to their mapblklot, exactly as chunks do.
CREATE OR REPLACE TEMP TABLE s_map_a AS
SELECT a.blklot, min(a.mapblklot) AS current_id
FROM s_attr a JOIN parcels p ON p.id = a.mapblklot
GROUP BY a.blklot;

-- (b) Otherwise, the smallest current parcel containing a retired row's centroid.
CREATE OR REPLACE TEMP TABLE s_map_b AS
SELECT a.blklot, min(p.id) AS current_id
FROM s_attr a JOIN parcels p ON ST_Contains(p.geom, a.c)
WHERE NOT a.active AND a.c IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM s_map_a m WHERE m.blklot = a.blklot)
GROUP BY a.blklot;

-- (c) Anything else is unmatched (no row here).
CREATE OR REPLACE TEMP TABLE s_blklot_map AS
SELECT blklot, current_id, 'a' AS how FROM s_map_a
UNION ALL
SELECT blklot, current_id, 'b' AS how FROM s_map_b;

-- T13 lineage: one row per retired attrs row with a blklot; current_mapblklot NULL = unmatched.
CREATE OR REPLACE TABLE parcel_lineage AS
SELECT a.blklot, a.mapblklot AS retired_mapblklot, m.current_id AS current_mapblklot,
       a.date_rec_drop
FROM s_attr a
LEFT JOIN s_blklot_map m USING (blklot)
WHERE NOT a.active
ORDER BY a.blklot, a.mapblklot, a.date_rec_drop;

-- Every roll row with its current parcel (id NULL = unmatched) and the rule that mapped it.
CREATE OR REPLACE TEMP TABLE s_roll AS
SELECT r.*, m.current_id AS id, m.how
FROM src_roll r
LEFT JOIN s_blklot_map m ON m.blklot = r.parcel_number
WHERE r.closed_roll_year IS NOT NULL;

-- landUseClass from the mapped row with the largest property_area; ties by the smallest
-- parcel_number, then use_code (then class code, for a total order).
CREATE OR REPLACE TEMP TABLE s_roll_pick AS
SELECT id, closed_roll_year, use_code, property_class_code
FROM s_roll
WHERE id IS NOT NULL
QUALIFY row_number() OVER (
  PARTITION BY id, closed_roll_year
  ORDER BY coalesce(property_area, 0) DESC, parcel_number, use_code, property_class_code
) = 1;

-- Spec §4.5 mapping (the mapping is the spec author's, I; use codes from the 2025 $group, V).
-- A property_class_code starting V (vacant) overrides; unmapped use codes are other.
CREATE OR REPLACE TEMP TABLE s_roll_class AS
SELECT k.id, k.closed_roll_year, k.use_code, c.idx AS land_use_class
FROM s_roll_pick k
JOIN sc_land_use_classes c ON c.name = CASE
  WHEN starts_with(k.property_class_code, 'V') THEN 'vacant'
  WHEN k.use_code IN ('SRES', 'MRES') THEN 'residential'
  WHEN k.use_code = 'MISC' THEN 'mixed'
  WHEN k.use_code IN ('COMM', 'COMR', 'COMO', 'COMH') THEN 'commercial'
  WHEN k.use_code = 'IND' THEN 'pdr'
  ELSE 'other' END;

-- Aggregation per (current parcel, roll year), spec §4.5:
-- units = Σ units; stories = max; year_built = min valid year over rows with units > 0, else over
-- all rows (invalid years are already NULL, normalise); land/impr = Σ assessed values;
-- floor_area_m2 = Σ property_area × 0.09290304 (m² per sf, exact by definition, tier 0).
-- noncondo_units: Σ units over rows outside the condo classes (spec §4.4 rent-control exclusion,
-- tier 2: Z ZBM ZEU LZ LZBM CZ OZ PZ IZ GZ BZ OZEU, Costa-Hawkins, I).
-- hotel: any row in the hotel classes (spec §4.4, tier 2: H H1 H2 HC HG RH RH1 RHG, codes V from
-- the 2025 $group; M/MG motels are not hotels, Bulletin 11 footnote 4).
-- status_n: any row with status_code N (non-taxable, e.g. government).
CREATE OR REPLACE TEMP TABLE s_roll_sum AS
SELECT id, closed_roll_year AS roll_year,
       coalesce(sum(number_of_units), 0)::INTEGER AS units,
       coalesce(max(number_of_stories), 0)::INTEGER AS stories,
       coalesce(min(year_property_built) FILTER (WHERE number_of_units > 0),
                min(year_property_built))::INTEGER AS year_built,
       coalesce(list_sum(list(assessed_land_value ORDER BY assessed_land_value)
                         FILTER (WHERE assessed_land_value IS NOT NULL)), 0)::DOUBLE AS land,
       coalesce(list_sum(list(assessed_improvement_value ORDER BY assessed_improvement_value)
                         FILTER (WHERE assessed_improvement_value IS NOT NULL)), 0)::DOUBLE AS impr,
       coalesce(list_sum(list(property_area ORDER BY property_area)
                         FILTER (WHERE property_area IS NOT NULL)), 0)::DOUBLE
         * 0.09290304 AS floor_area_m2,
       coalesce(sum(number_of_units) FILTER (WHERE property_class_code IS NULL
         OR property_class_code NOT IN ('Z', 'ZBM', 'ZEU', 'LZ', 'LZBM', 'CZ', 'OZ', 'PZ', 'IZ',
                                        'GZ', 'BZ', 'OZEU')), 0)::INTEGER AS noncondo_units,
       coalesce(bool_or(property_class_code IN ('H', 'H1', 'H2', 'HC', 'HG', 'RH', 'RH1', 'RHG')),
                false) AS hotel,
       coalesce(bool_or(status_code = 'N'), false) AS status_n
FROM s_roll
WHERE id IS NOT NULL
GROUP BY id, closed_roll_year;

CREATE OR REPLACE TABLE sc_roll_agg AS
SELECT s.id, s.roll_year, s.units, s.stories, s.year_built, s.land, s.impr, s.floor_area_m2,
       c.use_code, c.land_use_class::INTEGER AS land_use_class, s.noncondo_units, s.hotel,
       s.status_n
FROM s_roll_sum s
JOIN s_roll_class c ON c.id = s.id AND c.closed_roll_year = s.roll_year
ORDER BY s.id, s.roll_year;

-- scenario.height.*: `none` = parcels in a district whose string has no height (sentinels and
-- parse failures); `no_district` = parcels overlapping no district (disjoint from `none`).
INSERT INTO report_counts
SELECT 'scenario.height.none', count(*) FROM sc_district WHERE district <> '' AND kind = 'none';
INSERT INTO report_counts
SELECT 'scenario.height.no_district', count(*) FROM sc_district WHERE district = '';
INSERT INTO report_counts
SELECT 'scenario.height.split', count(*) FROM sc_district WHERE split;
INSERT INTO report_counts
SELECT 'scenario.height.split_units', coalesce(sum(o.units), 0)
FROM sc_district d JOIN parcel_out o USING (id) WHERE d.split;
-- Raw overlap sum above the parcel area by more than 1e-4 (a floating-point allowance, tier 4).
INSERT INTO report_counts
SELECT 'scenario.height.overlap_gt1', count(*) FROM s_frac WHERE raw_frac > 1.0001;
-- `//` strings that are not R-4 are not Local Program (spec §4.2 step 5).
INSERT INTO report_counts
SELECT 'scenario.height.dbl_non_r4', count(*)
FROM sc_district WHERE kind = 'height' AND NOT r4 AND lp_ft IS NOT NULL;

-- scenario.roll.*: years and latest over every roll row; matched_parcels = current parcels with
-- a mapped row in any year; unmatched rows and their units per year (every year, 0 included);
-- lineage_retired = roll rows mapped by rule (b), a retired row's centroid.
INSERT INTO report_counts
SELECT 'scenario.roll.years', count(DISTINCT closed_roll_year) FROM s_roll;
INSERT INTO report_counts
SELECT 'scenario.roll.latest', max(closed_roll_year) FROM s_roll;
INSERT INTO report_counts
SELECT 'scenario.roll.matched_parcels', count(DISTINCT id) FROM sc_roll_agg;
INSERT INTO report_counts
SELECT 'scenario.roll.unmatched.' || closed_roll_year, count(*) FILTER (WHERE id IS NULL)
FROM s_roll GROUP BY closed_roll_year ORDER BY closed_roll_year;
INSERT INTO report_counts
SELECT 'scenario.roll.unmatched_units.' || closed_roll_year,
       coalesce(sum(number_of_units) FILTER (WHERE id IS NULL), 0)
FROM s_roll GROUP BY closed_roll_year ORDER BY closed_roll_year;
INSERT INTO report_counts
SELECT 'scenario.roll.lineage_retired', count(*) FROM s_roll WHERE how = 'b';
