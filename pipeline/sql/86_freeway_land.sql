-- 86_freeway_land: candidate freeway-land parcels per catalog segment (lesscars v1.1 spec
-- "Freeway land"). Run by pipeline/steps/lesscars-freeway-land.ts, not by runSql, after runSql
-- (parcel_out and land_mask from 60/45, parcels, src_parcel_attrs). Reads src_streets and the
-- input table fl_seg(segment_id, ord, cnn), with variables fl_band_m and fl_min_share. Writes
-- fl_candidate and fl_row. Every aggregate over geometry is ordered, so the result does not
-- depend on scan order.
--
-- The rule only proposes; the curated catalog decides. A parcel is a candidate of a segment when
--   units = 0, and (land_use = 'VACANT', or zoning P with no building: height 0, floor area 0),
--   and at least fl_min_share of its (land-clipped) area lies within fl_band_m of the segment's
--   street lines. "At least" is inclusive: the 1e-6 tolerance absorbs projection noise on a parcel
--   exactly half in the band. Open space (land_use OPENSPACE) is proposed, not filtered: the
--   caller flags it for curation (a park is an exclusion).
-- A parcel in several segments' bands goes to the nearest segment (smaller segment id on a tie).
-- The band is the lines' round-capped buffer.
-- Zoning is picked as 80_scenario.sql sc_zoning picks it (blklot = mapblklot first, else the
-- smallest blklot), here only for the candidate pool, so this file needs no 80_scenario run.

CREATE OR REPLACE TEMP TABLE fl_line AS
SELECT g.segment_id, g.ord, ST_Union_Agg(s.geom ORDER BY s.cnn) AS geom
FROM fl_seg g JOIN src_streets s USING (cnn)
GROUP BY g.segment_id, g.ord;

CREATE OR REPLACE TEMP TABLE fl_band AS
SELECT segment_id, ord, geom AS line,
       ST_Buffer(geom, getvariable('fl_band_m')) AS band
FROM fl_line;

CREATE OR REPLACE TEMP TABLE fl_zoning AS
SELECT mapblklot AS id, zoning_code
FROM src_parcel_attrs
WHERE active AND mapblklot IS NOT NULL
QUALIFY row_number() OVER (
  PARTITION BY mapblklot ORDER BY (blklot = mapblklot) DESC, blklot, zoning_code
) = 1;

CREATE OR REPLACE TEMP TABLE fl_pool AS
SELECT o.id, o.geom, o.area_m2, o.land_use, o.units, o.height_m, o.floor_area_m2,
       o.label_lng, o.label_lat, z.zoning_code
FROM parcel_out o
LEFT JOIN fl_zoning z ON z.id = o.id
WHERE o.units = 0
  AND (o.land_use = 'VACANT'
       OR (z.zoning_code = 'P' AND o.height_m = 0 AND o.floor_area_m2 = 0))
  AND o.area_m2 > 0;

CREATE OR REPLACE TEMP TABLE fl_hit AS
SELECT * FROM (
  SELECT b.segment_id, b.ord, p.id,
         ST_Area(ST_Intersection(p.geom, b.band)) / p.area_m2 AS in_band_share,
         ST_Distance(p.geom, b.line) AS dist_m
  FROM fl_band b
  JOIN fl_pool p ON ST_Intersects(p.geom, b.band)
)
WHERE in_band_share >= getvariable('fl_min_share') - 1e-6;

-- Nearest segment per parcel; smaller segment id on a tie.
CREATE OR REPLACE TABLE fl_candidate AS
SELECT h.segment_id, h.ord, p.id, p.area_m2, least(h.in_band_share, 1.0) AS in_band_share,
       h.dist_m, p.land_use, p.zoning_code AS zoning, p.units::INTEGER AS units, p.height_m,
       p.label_lng, p.label_lat
FROM (
  SELECT * FROM fl_hit
  QUALIFY row_number() OVER (PARTITION BY id ORDER BY dist_m, segment_id) = 1
) h
JOIN fl_pool p USING (id)
ORDER BY h.ord, h.in_band_share DESC, p.id;

-- The unparcelled land (land mask less every parcel) within the band: a size, not a list.
CREATE OR REPLACE TABLE fl_row AS
SELECT b.segment_id, b.ord,
       coalesce(
         ST_Area(
           ST_Difference(
             ST_Intersection((SELECT geom FROM land_mask), b.band),
             coalesce(
               (SELECT ST_Union_Agg(p.geom ORDER BY p.id) FROM parcel_out p
                WHERE ST_Intersects(p.geom, b.band)),
               ST_GeomFromText('POLYGON EMPTY')
             )
           )
         ),
         0
       ) AS row_m2
FROM fl_band b
ORDER BY b.ord;
