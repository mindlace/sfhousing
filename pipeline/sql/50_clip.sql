-- 50_clip: clip buildings to parcels (spec §4.7). Reads buildings, parcels. Writes pieces and pieces.* counts.
-- One piece per (building, intersecting parcel); the part outside every parcel is emitted once with
-- parcel_id NULL. Pieces with area < min_piece_m2 are dropped; zero-area (edge-touching) hits are discarded
-- silently; remainders under min_piece_m2 are counted too (pieces.remainder_sliver_dropped). Areas in the report are rounded to 3 decimals so float summation order cannot leak.

CREATE OR REPLACE TEMP TABLE c_pairs AS
SELECT b.bid, p.id AS parcel_id,
       ST_CollectionExtract(ST_Intersection(b.geom, p.geom), 3) AS geom
FROM buildings b JOIN parcels p ON ST_Intersects(b.geom, p.geom);

CREATE OR REPLACE TEMP TABLE c_pairs_area AS
SELECT bid, parcel_id, geom, ST_Area(geom) AS area_m2 FROM c_pairs;

CREATE OR REPLACE TEMP TABLE c_remainder AS
SELECT b.bid,
       ST_CollectionExtract(ST_Difference(b.geom, u.geom), 3) AS geom
FROM buildings b
LEFT JOIN (
  SELECT b2.bid, ST_Union_Agg(p.geom) AS geom
  FROM buildings b2 JOIN parcels p ON ST_Intersects(b2.geom, p.geom)
  GROUP BY b2.bid
) u USING (bid);

-- Buildings with no intersecting parcel: u.geom is NULL, so the whole building is the remainder.
CREATE OR REPLACE TEMP TABLE c_rem_final AS
SELECT r.bid, coalesce(r.geom, b.geom) AS geom
FROM c_remainder r JOIN buildings b USING (bid);

CREATE OR REPLACE TABLE pieces AS
SELECT bid, parcel_id, geom, area_m2, height_m, base_m, hs FROM (
  SELECT x.bid, x.parcel_id, x.geom, x.area_m2, b.height_m, b.base_m, b.hs
  FROM c_pairs_area x JOIN buildings b USING (bid)
  WHERE x.area_m2 >= getvariable('min_piece_m2')
  UNION ALL
  SELECT r.bid, NULL::VARCHAR, r.geom, ST_Area(r.geom), b.height_m, b.base_m, b.hs
  FROM c_rem_final r JOIN buildings b USING (bid)
  WHERE NOT ST_IsEmpty(r.geom) AND ST_Area(r.geom) >= getvariable('min_piece_m2')
)
ORDER BY bid, parcel_id NULLS LAST;

INSERT INTO report_counts SELECT 'pieces.count', count(*) FROM pieces;
-- sliver_dropped = parcel pieces + remainders under min_piece_m2 (area > 0); remainder share reported apart.
INSERT INTO report_counts
SELECT 'pieces.sliver_dropped',
       (SELECT count(*) FROM c_pairs_area WHERE area_m2 > 0 AND area_m2 < getvariable('min_piece_m2'))
       + (SELECT count(*) FROM c_rem_final
          WHERE NOT ST_IsEmpty(geom) AND ST_Area(geom) > 0 AND ST_Area(geom) < getvariable('min_piece_m2'));
INSERT INTO report_counts
SELECT 'pieces.remainder_sliver_dropped', count(*) FROM c_rem_final
WHERE NOT ST_IsEmpty(geom) AND ST_Area(geom) > 0 AND ST_Area(geom) < getvariable('min_piece_m2');
INSERT INTO report_counts
SELECT 'pieces.outside_parcels', count(*) FROM pieces WHERE parcel_id IS NULL;
INSERT INTO report_counts
SELECT 'pieces.area_total_m2', round(coalesce(sum(area_m2), 0), 3) FROM pieces;
INSERT INTO report_counts
SELECT 'pieces.area_with_parcel_m2', round(coalesce(sum(area_m2), 0), 3)
FROM pieces WHERE parcel_id IS NOT NULL;
