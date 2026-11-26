-- 76_render_boxes: the render-only boxes and their parcel clip (docs/dev/pipeline.md, Building
-- boxes in build). Not in SQL_FILES: pipeline/steps/render-boxes.ts runs it after loading the
-- locked building-boxes artifact into bx_boxes(bid, k, src, base_m, height_m, geom GEOMETRY, NULL
-- = the whole footprint) and bx_roofs. Reads buildings, parcels, bx_boxes, bx_roofs. Writes
-- render_boxes, render_pieces, render_export and low_export (the z12-13 tiles' input); never
-- touches pieces, parcel_out or buildings_export, so the model's inputs do not move.
--
-- A building is drawn by its artifact rows; one with no row (a fallback, or a bid the artifact
-- lacks) gets today's single box (src 'box', k 0) from buildings. Row absence decides it, not
-- bx_roofs.fallback: a parts building whose uncovered area fell back keeps its part rows and must
-- not also get a full-height box. Artifact rows of bids not in buildings are ignored.

CREATE OR REPLACE TABLE render_boxes AS
SELECT bid, k, src, base_m, height_m, hs, ground_m, ground_min_m, geom FROM (
  SELECT x.bid, x.k, x.src, x.base_m, x.height_m, b.hs, r.ground_m, r.ground_min_m,
         coalesce(x.geom, b.geom) AS geom
  FROM bx_boxes x JOIN buildings b USING (bid) LEFT JOIN bx_roofs r USING (bid)
  UNION ALL
  SELECT b.bid, 0, 'box', b.base_m, b.height_m, b.hs, r.ground_m, r.ground_min_m, b.geom
  FROM buildings b LEFT JOIN bx_roofs r USING (bid)
  WHERE b.bid NOT IN (SELECT bid FROM bx_boxes)
)
ORDER BY bid, k;

-- The clip mirrors 50_clip.sql (which must not change) per box, with render_min_piece_m2 in place
-- of min_piece_m2 so thin false-front strips survive. A box over the whole footprint is clipped
-- exactly as pieces clips its building.
CREATE OR REPLACE TEMP TABLE rb_pairs AS
SELECT x.bid, x.k, p.id AS parcel_id,
       ST_CollectionExtract(ST_Intersection(x.geom, p.geom), 3) AS geom
FROM render_boxes x JOIN parcels p ON ST_Intersects(x.geom, p.geom);

CREATE OR REPLACE TEMP TABLE rb_pairs_area AS
SELECT bid, k, parcel_id, geom, ST_Area(geom) AS area_m2 FROM rb_pairs;

CREATE OR REPLACE TEMP TABLE rb_remainder AS
SELECT x.bid, x.k,
       ST_CollectionExtract(ST_Difference(x.geom, u.geom), 3) AS geom
FROM render_boxes x
LEFT JOIN (
  SELECT x2.bid, x2.k, ST_Union_Agg(p.geom) AS geom
  FROM render_boxes x2 JOIN parcels p ON ST_Intersects(x2.geom, p.geom)
  GROUP BY x2.bid, x2.k
) u USING (bid, k);

-- Boxes with no intersecting parcel: u.geom is NULL, so the whole box is the remainder.
CREATE OR REPLACE TEMP TABLE rb_rem_final AS
SELECT r.bid, r.k, coalesce(r.geom, x.geom) AS geom
FROM rb_remainder r JOIN render_boxes x USING (bid, k);

CREATE OR REPLACE TABLE render_pieces AS
SELECT bid, k, src, parcel_id, geom, area_m2, base_m, height_m, hs, ground_m, ground_min_m FROM (
  SELECT p.bid, p.k, x.src, p.parcel_id, p.geom, p.area_m2, x.base_m, x.height_m, x.hs,
         x.ground_m, x.ground_min_m
  FROM rb_pairs_area p JOIN render_boxes x USING (bid, k)
  WHERE p.area_m2 >= getvariable('render_min_piece_m2')
  UNION ALL
  SELECT r.bid, r.k, x.src, NULL::VARCHAR, r.geom, ST_Area(r.geom), x.base_m, x.height_m, x.hs,
         x.ground_m, x.ground_min_m
  FROM rb_rem_final r JOIN render_boxes x USING (bid, k)
  WHERE NOT ST_IsEmpty(r.geom) AND ST_Area(r.geom) >= getvariable('render_min_piece_m2')
)
ORDER BY bid, k, parcel_id NULLS LAST;

CREATE OR REPLACE TABLE render_export AS
SELECT parcel_id, bid, k, src, height_m, base_m, hs, ground_m, ground_min_m,
       ST_AsGeoJSON(ST_Transform(geom, 'EPSG:7131', 'EPSG:4326', always_xy := true)) AS geojson4326
FROM render_pieces
ORDER BY parcel_id NULLS LAST, bid, k;

-- Parts buildings at z12-13 are their render boxes; every other building is today's export.
CREATE OR REPLACE TABLE low_export AS
SELECT parcel_id, bid, 0 AS k, height_m, base_m, hs, geojson4326 FROM buildings_export
WHERE bid NOT IN (SELECT bid FROM render_boxes WHERE src = 'part')
UNION ALL
SELECT parcel_id, bid, k, height_m, base_m, hs, geojson4326 FROM render_export
WHERE bid IN (SELECT bid FROM render_boxes WHERE src = 'part')
ORDER BY parcel_id NULLS LAST, bid, k;
