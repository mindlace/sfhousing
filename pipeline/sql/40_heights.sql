-- 40_heights: height fill, first match wins (spec §4.6). Reads b_base, src_footprints.
-- Writes buildings and buildings.kept/hs0..hs3, height.max_m counts.
-- Only footprints with mblr 'SF%' count (spec §4.6; right-of-way rows are 'CN…').
-- hs 0 overture height; 1 DataSF hgt_median_m (best IoU >= iou_min, ties -> smaller sf16_bldgid, then mblr);
-- 2 num_floors * floors_m; 3 default. A footprint without hgt_median_m cannot supply a height, so is not a candidate.

CREATE OR REPLACE TEMP TABLE h_fp AS
SELECT mblr, sf16_bldgid, hgt_median_m,
       ST_CollectionExtract(
         ST_MakeValid(ST_Transform(geom::GEOMETRY, 'EPSG:4326', 'EPSG:7131', always_xy := true)), 3
       ) AS geom
FROM src_footprints
WHERE mblr LIKE 'SF%' AND hgt_median_m IS NOT NULL;

CREATE OR REPLACE TEMP TABLE h_pairs AS
SELECT b.bid, f.mblr, f.sf16_bldgid, f.hgt_median_m,
       ST_Area(ST_Intersection(b.geom, f.geom)) / ST_Area(ST_Union(b.geom, f.geom)) AS iou
FROM b_base b JOIN h_fp f ON ST_Intersects(b.geom, f.geom)
WHERE b.height IS NULL OR b.height <= 0;

CREATE OR REPLACE TEMP TABLE h_best AS
SELECT bid, hgt_median_m FROM (
  SELECT *, row_number() OVER (
    PARTITION BY bid ORDER BY iou DESC, sf16_bldgid, mblr
  ) AS rn
  FROM h_pairs WHERE iou >= getvariable('iou_min')
) WHERE rn = 1;

CREATE OR REPLACE TEMP TABLE h_raw AS
SELECT b.bid, b.geom, b.datasets, coalesce(b.min_height, 0) AS base_m,
       CASE WHEN b.height > 0 THEN b.height
            WHEN h.bid IS NOT NULL THEN h.hgt_median_m
            WHEN b.num_floors > 0 THEN b.num_floors * getvariable('floors_m')
            ELSE getvariable('default_height_m') END AS raw_m,
       CASE WHEN b.height > 0 THEN 0
            WHEN h.bid IS NOT NULL THEN 1
            WHEN b.num_floors > 0 THEN 2
            ELSE 3 END AS hs
FROM b_base b LEFT JOIN h_best h USING (bid);

CREATE OR REPLACE TABLE buildings AS
SELECT bid, geom,
       round(least(340.0, greatest(2.5, raw_m)), 1)::DOUBLE AS height_m,
       base_m::DOUBLE AS base_m,
       hs::INTEGER AS hs,
       datasets
FROM h_raw
ORDER BY bid;

INSERT INTO report_counts SELECT 'buildings.kept', count(*) FROM buildings;
INSERT INTO report_counts
SELECT 'buildings.hs' || k.hs, count(b.bid)
FROM (SELECT unnest(range(4)) AS hs) k LEFT JOIN buildings b ON b.hs = k.hs
GROUP BY k.hs;
INSERT INTO report_counts SELECT 'height.max_m', coalesce(max(height_m), 0) FROM buildings;
