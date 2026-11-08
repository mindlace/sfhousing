-- 55_road_lots: lots that are road (street remnants, medians, slopes, strips beside freeways),
-- which stay on the map with their buildings but are never candidates for building. Reads parcels
-- (with underwater, from 45_land), pieces (50_clip), parcel_landuse, src_parcel_attrs, src_roll,
-- src_streets, src_city_lands and the input tables rl_word(word, pattern), rl_catalog(id),
-- rl_keep(parcel, block, reason) and rl_road(parcel, reason) (pipeline/lib/road-lots.ts). Writes
-- road_lot_eval, road_lots, the road_like.* counts and the sd.parcels.road-like quality tally.
--
-- A lot is evaluated when its owner is public and it is not underwater (an underwater lot is
-- already ineligible, so the two sets stay disjoint). Public: zoning P, or the latest roll year's
-- class one of VPUB, VG, IXG, IG, PLG, OG, GG, EG, or a City Lands row names it. A City Lands row
-- names the lot when it covers the largest share of the lot's area of any row and that share is at
-- least road_city_share_min (ties by land_id); one name per lot, so a sliver of a neighbouring
-- strip never names a house lot.
-- The raw rule flags an evaluated lot when its building cover (pieces over lot area) is under
-- road_cover_max, it has no homes (parcel_landuse.units 0), it is not freeway-land catalog land
-- (rl_catalog), and any of:
--   R7  the City Lands name holds a word of rl_word (whole word, upper-cased);
--   R1n cover under road_bare_cover_max and the maximum inscribed circle (tolerance road_mic_tol_m)
--       has a radius under road_strip_radius_m;
--   R2s cover under road_bare_cover_max and at least road_street_share_min of the lot lies within
--       road_street_band_m of a public street centreline (not FREEWAYS, PRIVATE, PRIVATE_PARKING,
--       PAPER_WATER or PARKS%), the band the union of round-capped buffers;
--   R3  a FREEWAYS centreline crosses the lot, or the centreline nearest its point on surface (any
--       layer, within road_nearest_search_m, ties by the smaller cnn) is a FREEWAYS line under
--       road_freeway_m from that point.
-- road_lots: raw lots no keep row keeps (a parcel row first, then a block row: the id's leading
-- 4 digits and optional capital letter, so 0026 and 0026T are separate blocks), plus every rl_road lot that is not catalog land and not underwater (it
-- skips the other gates). Reason: override for a road row, else the first of r7, r1n, r2s, r3 that
-- fires. "At least" shares are inclusive with a 1e-6 tolerance. Every aggregate over geometry or
-- area is ordered, so the result does not depend on scan order (V12).

-- Zoning, as 86_freeway_land.sql picks it (active rows, blklot = mapblklot first).
CREATE OR REPLACE TEMP TABLE rl_zoning AS
SELECT mapblklot AS id, zoning_code
FROM src_parcel_attrs
WHERE active AND mapblklot IS NOT NULL
QUALIFY row_number() OVER (
  PARTITION BY mapblklot ORDER BY (blklot = mapblklot) DESC, blklot, zoning_code
) = 1;

-- Roll class: the latest roll year's row that 80_scenario.sql picks for the lot (largest
-- property_area, then parcel_number, use_code, property_class_code), with roll rows mapped to the
-- lot through src_parcel_attrs.blklot -> mapblklot (80_scenario.sql s_map_a).
CREATE OR REPLACE TEMP TABLE rl_blklot_map AS
SELECT a.blklot, min(a.mapblklot) AS id
FROM src_parcel_attrs a JOIN parcels p ON p.id = a.mapblklot
WHERE a.blklot IS NOT NULL
GROUP BY a.blklot;

CREATE OR REPLACE TEMP TABLE rl_roll AS
SELECT m.id, r.property_class_code AS roll_class
FROM src_roll r
JOIN rl_blklot_map m ON m.blklot = r.parcel_number
WHERE r.closed_roll_year = (SELECT max(closed_roll_year) FROM src_roll)
QUALIFY row_number() OVER (
  PARTITION BY m.id
  ORDER BY coalesce(r.property_area, 0) DESC, r.parcel_number, r.use_code, r.property_class_code
) = 1;

-- City Lands: the row covering the largest share of each lot, when that share is at least
-- road_city_share_min.
-- land_id is not unique upstream: row_id numbers the rows in a total order (land_id, then the
-- geometry, as normalise orders them), so a row is counted by its identity.
CREATE OR REPLACE TEMP TABLE rl_city AS
SELECT row_number() OVER (ORDER BY land_id, ST_AsHEXWKB(geom), land_name, department_name)
         AS row_id,
       land_id, land_name, department_name, ST_MakeValid(geom) AS geom
FROM src_city_lands
WHERE geom IS NOT NULL;

CREATE OR REPLACE TEMP TABLE rl_city_name AS
SELECT id, row_id, land_id, land_name, department_name, share FROM (
  SELECT p.id, c.row_id, c.land_id, c.land_name, c.department_name, c.geom,
         ST_Area(ST_Intersection(p.geom, c.geom)) / ST_Area(p.geom) AS share
  FROM parcels p JOIN rl_city c ON ST_Intersects(p.geom, c.geom)
  WHERE ST_Area(p.geom) > 0
)
WHERE share >= getvariable('road_city_share_min') - 1e-6
QUALIFY row_number() OVER (
  PARTITION BY id ORDER BY share DESC, land_id, ST_AsHEXWKB(geom)
) = 1;

-- Building cover per lot, summed in bid order.
CREATE OR REPLACE TEMP TABLE rl_cover AS
SELECT parcel_id AS id, list_sum(list(area_m2 ORDER BY bid)) AS piece_m2
FROM pieces WHERE parcel_id IS NOT NULL
GROUP BY parcel_id;

-- The candidate pool: public, not underwater.
CREATE OR REPLACE TEMP TABLE rl_pool AS
SELECT p.id, p.geom, ST_Area(p.geom) AS area_m2, z.zoning_code, r.roll_class,
       c.land_name, c.department_name AS department,
       CASE WHEN ST_Area(p.geom) > 0 THEN coalesce(v.piece_m2, 0) / ST_Area(p.geom) END AS cover,
       l.units, l.eligible
FROM parcels p
JOIN parcel_landuse l USING (id)
LEFT JOIN rl_zoning z USING (id)
LEFT JOIN rl_roll r USING (id)
LEFT JOIN rl_city_name c USING (id)
LEFT JOIN rl_cover v USING (id)
WHERE NOT p.underwater
  AND (z.zoning_code = 'P'
       OR r.roll_class IN ('VPUB', 'VG', 'IXG', 'IG', 'PLG', 'OG', 'GG', 'EG')
       OR c.id IS NOT NULL);

-- R1n's inscribed radius, only for bare lots.
CREATE OR REPLACE TEMP TABLE rl_mic AS
SELECT id, (ST_MaximumInscribedCircle(geom, getvariable('road_mic_tol_m'))).radius AS mic_r
FROM rl_pool
WHERE cover < getvariable('road_bare_cover_max');

-- R2s: the share of each bare lot within road_street_band_m of a public street centreline.
CREATE OR REPLACE TEMP TABLE rl_pub_street AS
SELECT cnn, layer, streetname, geom FROM src_streets
WHERE geom IS NOT NULL
  AND coalesce(layer, '') NOT IN ('FREEWAYS', 'PRIVATE', 'PRIVATE_PARKING', 'PAPER_WATER')
  AND coalesce(layer, '') NOT LIKE 'PARKS%';

CREATE OR REPLACE TEMP TABLE rl_band AS
SELECT p.id,
       ST_Area(ST_Intersection(
         p.geom,
         ST_Union_Agg(ST_Buffer(s.geom, getvariable('road_street_band_m'))
                      ORDER BY s.cnn, s.layer, s.streetname, ST_AsHEXWKB(s.geom))
       )) / p.area_m2 AS street_share
FROM rl_pool p
JOIN rl_pub_street s ON ST_DWithin(p.geom, s.geom, getvariable('road_street_band_m'))
WHERE p.cover < getvariable('road_bare_cover_max') AND p.area_m2 > 0
GROUP BY p.id, p.geom, p.area_m2;

-- R3: a FREEWAYS line crossing the lot, and the centreline nearest its point on surface.
CREATE OR REPLACE TEMP TABLE rl_fwy_cross AS
SELECT DISTINCT p.id
FROM rl_pool p
JOIN src_streets s ON s.layer = 'FREEWAYS' AND ST_Intersects(p.geom, s.geom);

CREATE OR REPLACE TEMP TABLE rl_nearest AS
SELECT p.id, s.streetname AS nearest_street, s.layer AS nearest_layer,
       ST_Distance(p.pt, s.geom) AS nearest_m
FROM (SELECT id, ST_PointOnSurface(geom) AS pt FROM rl_pool) p
JOIN src_streets s
  ON s.geom IS NOT NULL AND ST_DWithin(p.pt, s.geom, getvariable('road_nearest_search_m'))
QUALIFY row_number() OVER (
  PARTITION BY p.id ORDER BY ST_Distance(p.pt, s.geom), s.cnn, s.layer, ST_AsHEXWKB(s.geom)
) = 1;

CREATE OR REPLACE TEMP TABLE rl_rules AS
SELECT p.id, p.zoning_code, p.roll_class, p.land_name, p.department, p.cover, m.mic_r,
       b.street_share, n.nearest_street, n.nearest_layer, n.nearest_m, p.units, p.eligible,
       EXISTS (SELECT 1 FROM rl_catalog k WHERE k.id = p.id) AS in_catalog,
       coalesce(p.land_name IS NOT NULL AND EXISTS (
         SELECT 1 FROM rl_word w WHERE regexp_matches(upper(p.land_name), w.pattern)
       ), false) AS r7,
       coalesce(p.cover < getvariable('road_bare_cover_max')
                AND m.mic_r < getvariable('road_strip_radius_m'), false) AS r1n,
       coalesce(p.cover < getvariable('road_bare_cover_max')
                AND b.street_share >= getvariable('road_street_share_min') - 1e-6, false) AS r2s,
       f.id IS NOT NULL
         OR coalesce(n.nearest_layer = 'FREEWAYS'
                     AND n.nearest_m < getvariable('road_freeway_m'), false) AS r3,
       coalesce(p.cover < getvariable('road_cover_max'), false) AND p.units = 0 AS gates
FROM rl_pool p
LEFT JOIN rl_mic m USING (id)
LEFT JOIN rl_band b USING (id)
LEFT JOIN rl_nearest n USING (id)
LEFT JOIN rl_fwy_cross f USING (id);

CREATE OR REPLACE TABLE road_lot_eval AS
SELECT r.id, r.zoning_code, r.roll_class, r.land_name, r.department, r.cover, r.mic_r,
       r.street_share, r.nearest_street, r.nearest_layer, r.nearest_m, r.units, r.in_catalog,
       r.r7, r.r1n, r.r2s, r.r3,
       r.gates AND NOT r.in_catalog AND (r.r7 OR r.r1n OR r.r2s OR r.r3) AS raw,
       coalesce(
         (SELECT k.reason FROM rl_keep k WHERE k.parcel = r.id ORDER BY k.reason LIMIT 1),
         (SELECT k.reason FROM rl_keep k
          WHERE k.block = regexp_extract(r.id, '^[0-9]{4}[A-Z]?') ORDER BY k.reason LIMIT 1)
       ) AS kept_by,
       EXISTS (SELECT 1 FROM rl_road d WHERE d.parcel = r.id) AS listed
FROM rl_rules r
ORDER BY r.id;

-- Lots the raw rule would flag but for the catalog.
CREATE OR REPLACE TEMP TABLE rl_catalog_excluded AS
SELECT id FROM rl_rules WHERE gates AND in_catalog AND (r7 OR r1n OR r2s OR r3);

CREATE OR REPLACE TABLE road_lots AS
SELECT id, reason, eligible_without FROM (
  SELECT e.id,
         CASE WHEN e.listed THEN 'override' WHEN e.r7 THEN 'r7' WHEN e.r1n THEN 'r1n'
              WHEN e.r2s THEN 'r2s' ELSE 'r3' END AS reason,
         r.eligible AS eligible_without
  FROM road_lot_eval e JOIN rl_rules r USING (id)
  WHERE (e.raw AND e.kept_by IS NULL) OR (e.listed AND NOT e.in_catalog)
  UNION ALL
  -- A road row outside the evaluated lots skips the gates.
  SELECT p.id, 'override', l.eligible AND NOT p.underwater
  FROM rl_road d
  JOIN parcels p ON p.id = d.parcel
  JOIN parcel_landuse l ON l.id = p.id
  WHERE NOT p.underwater
    AND NOT EXISTS (SELECT 1 FROM road_lot_eval e WHERE e.id = p.id)
    AND NOT EXISTS (SELECT 1 FROM rl_catalog k WHERE k.id = p.id)
)
ORDER BY id;

INSERT INTO report_counts SELECT 'road_like.candidates', count(*) FROM road_lot_eval;
INSERT INTO report_counts SELECT 'road_like.raw', count(*) FROM road_lot_eval WHERE raw;
INSERT INTO report_counts SELECT 'road_like.raw.r7', count(*) FROM road_lot_eval WHERE raw AND r7;
INSERT INTO report_counts
SELECT 'road_like.raw.r1n', count(*) FROM road_lot_eval WHERE raw AND r1n;
INSERT INTO report_counts
SELECT 'road_like.raw.r2s', count(*) FROM road_lot_eval WHERE raw AND r2s;
INSERT INTO report_counts SELECT 'road_like.raw.r3', count(*) FROM road_lot_eval WHERE raw AND r3;
INSERT INTO report_counts
SELECT 'road_like.kept', count(*) FROM road_lot_eval WHERE raw AND kept_by IS NOT NULL;
-- Road rows that name a parcel.
INSERT INTO report_counts
SELECT 'road_like.listed', count(*) FROM rl_road d JOIN parcels p ON p.id = d.parcel;
INSERT INTO report_counts SELECT 'road_like.catalog_excluded', count(*) FROM rl_catalog_excluded;
INSERT INTO report_counts SELECT 'road_like.lots', count(*) FROM road_lots;
INSERT INTO report_counts
SELECT 'road_like.lots.' || k.reason, count(r.id)
FROM (VALUES ('r7'), ('r1n'), ('r2s'), ('r3'), ('override')) k(reason)
LEFT JOIN road_lots r ON r.reason = k.reason
GROUP BY k.reason;
INSERT INTO report_counts SELECT 'road_like.city_lands.rows', count(*) FROM src_city_lands;
INSERT INTO report_counts SELECT 'road_like.city_lands.named_lots', count(*) FROM rl_city_name;
-- City Lands rows that name no lot (ignored by the rule), by row identity; a row with no
-- geometry names none.
INSERT INTO report_counts
SELECT 'road_like.city_lands.unmatched',
       (SELECT count(*) FROM src_city_lands WHERE geom IS NULL)
       + (SELECT count(*) FROM rl_city c
          WHERE NOT EXISTS (SELECT 1 FROM rl_city_name n WHERE n.row_id = c.row_id));

-- sd.ts. Idempotent on one database: drop this file's tallies from an earlier run.
DELETE FROM quality_tally WHERE rule_id = 'sd.parcels.road-like';
DELETE FROM quality_sample WHERE rule_id = 'sd.parcels.road-like';
INSERT INTO quality_tally
SELECT 'sd.parcels.road-like', (SELECT count(*) FROM road_lots), count(*), NULL, NULL
FROM parcels;
INSERT INTO quality_sample SELECT 'sd.parcels.road-like', id FROM road_lots;
