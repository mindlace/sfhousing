-- 45_land: clip every lot to dry land (docs/dev/pipeline.md "Land mask"). Reads src_land, src_land_tiles, parcels,
-- buildings. Writes land_mask, parcel_land, parcels (rebuilt, plus geom_orig and underwater),
-- land.* counts and the sd.parcels.land-clip / sd.parcels.underwater quality tallies.
-- Land = OSM earth ∪ OSM pier polygons (src_land, z15) ∪ existing buildings. A lot that loses less
-- than land_min_removed_m2 keeps its geometry exactly; one with no dry piece of min_piece_m2 or more
-- keeps its outline and is flagged underwater; any other lot becomes its dry part (every piece).
-- Every aggregate over geometry or area is ordered, so the result does not depend on scan order.

-- Each feature clipped to its own tile, in 7131, snapped to a 1 cm grid.
CREATE OR REPLACE TEMP TABLE l_feat AS
SELECT layer, x, y, fid, geom FROM (
  SELECT layer, x, y, fid,
         ST_ReducePrecision(
           ST_Transform(
             ST_CollectionExtract(
               ST_Intersection(ST_MakeValid(ST_GeomFromGeoJSON(geojson)), ST_MakeEnvelope(w, s, e, n)),
               3
             ),
             'EPSG:4326', 'EPSG:7131', always_xy := true
           ),
           0.01
         ) AS geom
  FROM src_land WHERE z = 15
) WHERE NOT ST_IsEmpty(geom);

-- Union, then buffer out and back by land_seam_m (mitre joins keep corners square) to close the
-- seams between tiles, then simplify.
CREATE OR REPLACE TABLE land_mask AS
SELECT coalesce(
         ST_SimplifyPreserveTopology(
           ST_Buffer(
             ST_Buffer(u, getvariable('land_seam_m'), 8, 'CAP_FLAT', 'JOIN_MITRE', 5.0),
             -getvariable('land_seam_m'), 8, 'CAP_FLAT', 'JOIN_MITRE', 5.0
           ),
           getvariable('land_simplify_m')
         ),
         ST_GeomFromText('POLYGON EMPTY')
       ) AS geom
FROM (SELECT ST_Union_Agg(geom ORDER BY layer, x, y, fid) AS u FROM l_feat);

-- The mask cut into land_cell_m squares on a grid anchored at multiples of the cell size; cid is
-- row-major (y, then x).
CREATE OR REPLACE TEMP TABLE l_cells AS
WITH g AS (
  SELECT m.geom, c,
         floor(ST_XMin(m.geom) / c) * c AS gx, floor(ST_YMin(m.geom) / c) * c AS gy,
         ceil(ST_XMax(m.geom) / c)::BIGINT - floor(ST_XMin(m.geom) / c)::BIGINT AS nx,
         ceil(ST_YMax(m.geom) / c)::BIGINT - floor(ST_YMin(m.geom) / c)::BIGINT AS ny
  FROM land_mask m, (SELECT getvariable('land_cell_m') AS c)
  WHERE NOT ST_IsEmpty(m.geom)
),
gy_ AS (SELECT *, unnest(range(ny)) AS iy FROM g),
gxy AS (SELECT *, unnest(range(nx)) AS ix FROM gy_),
sq AS (
  SELECT geom, iy, ix,
         ST_MakeEnvelope(gx + ix * c, gy + iy * c, gx + (ix + 1) * c, gy + (iy + 1) * c) AS env
  FROM gxy
),
pieces AS (
  SELECT iy, ix, ST_CollectionExtract(ST_Intersection(geom, env), 3) AS geom
  FROM sq WHERE ST_Intersects(geom, env)
)
SELECT row_number() OVER (ORDER BY iy, ix)::INTEGER AS cid, geom
FROM pieces WHERE NOT ST_IsEmpty(geom);

-- Land area of every lot, from the cells it meets.
CREATE OR REPLACE TEMP TABLE l_area AS
SELECT p.id, ST_Area(p.geom) AS orig_m2, coalesce(a.land_m2, 0) AS land_m2
FROM parcels p
LEFT JOIN (
  SELECT p.id, list_sum(list(ST_Area(ST_Intersection(p.geom, c.geom)) ORDER BY c.cid)) AS land_m2
  FROM parcels p JOIN l_cells c ON ST_Intersects(p.geom, c.geom)
  GROUP BY p.id
) a USING (id);

CREATE OR REPLACE TEMP TABLE l_cand AS
SELECT p.id, p.geom FROM parcels p JOIN l_area a USING (id)
WHERE a.orig_m2 - a.land_m2 >= getvariable('land_min_removed_m2');

-- The dry bits of each candidate: its piece of each cell (src 0) and of each building (src 1).
CREATE OR REPLACE TEMP TABLE l_bits AS
SELECT id, src, cid, bid, geom FROM (
  SELECT p.id, 0 AS src, c.cid, NULL::VARCHAR AS bid,
         ST_CollectionExtract(ST_Intersection(p.geom, c.geom), 3) AS geom
  FROM l_cand p JOIN l_cells c ON ST_Intersects(p.geom, c.geom)
  UNION ALL
  SELECT p.id, 1, NULL, b.bid, ST_CollectionExtract(ST_Intersection(p.geom, b.geom), 3)
  FROM l_cand p JOIN buildings b ON ST_Intersects(p.geom, b.geom)
) WHERE NOT ST_IsEmpty(geom);

CREATE OR REPLACE TEMP TABLE l_union AS
SELECT id,
       ST_CollectionExtract(ST_Union_Agg(geom ORDER BY src, cid, bid), 3) AS dry_all,
       ST_Union_Agg(geom ORDER BY cid) FILTER (WHERE src = 0) AS land_only
FROM l_bits GROUP BY id;

-- Dry pieces of min_piece_m2 or more, largest first (ST_Dump path breaks ties).
CREATE OR REPLACE TEMP TABLE l_dry AS
SELECT id, ST_Collect(list(part ORDER BY area DESC, part_path)) AS dry,
       count(*)::INTEGER AS n_pieces
FROM (
  SELECT id, part, part_path, ST_Area(part) AS area FROM (
    SELECT id, struct_extract(d, 'geom') AS part, struct_extract(d, 'path') AS part_path
    FROM (SELECT id, unnest(ST_Dump(dry_all)) AS d FROM l_union)
  ) WHERE ST_GeometryType(part) = 'POLYGON'
) WHERE area >= getvariable('min_piece_m2')
GROUP BY id;

-- Status: underwater (a candidate with no dry piece), clipped (a candidate that still loses
-- land_min_removed_m2 or more), else kept as it was: unchanged below 0.01 m² of land lost (float
-- noise), jitter from 0.01 m² up to land_min_removed_m2.
CREATE OR REPLACE TEMP TABLE l_status AS
SELECT a.id, a.orig_m2, d.dry, d.n_pieces AS dry_pieces, c.id IS NOT NULL AS cand,
       CASE WHEN c.id IS NULL THEN a.land_m2 ELSE coalesce(ST_Area(d.dry), 0) END AS dry_m2,
       CASE WHEN c.id IS NOT NULL AND d.dry IS NULL THEN 'underwater'
            WHEN c.id IS NOT NULL
                 AND a.orig_m2 - ST_Area(d.dry) >= getvariable('land_min_removed_m2') THEN 'clipped'
            WHEN a.orig_m2 - (CASE WHEN c.id IS NULL THEN a.land_m2 ELSE ST_Area(d.dry) END) < 0.01
              THEN 'unchanged'
            ELSE 'jitter' END AS status,
       CASE WHEN d.dry IS NULL THEN 0
            ELSE greatest(ST_Area(d.dry) - coalesce(ST_Area(ST_Intersection(d.dry, u.land_only)), 0), 0)
       END AS building_m2
FROM l_area a
LEFT JOIN l_cand c USING (id)
LEFT JOIN l_dry d USING (id)
LEFT JOIN l_union u USING (id);

CREATE OR REPLACE TABLE parcel_land AS
SELECT s.id, s.status, s.orig_m2, s.dry_m2, s.orig_m2 - s.dry_m2 AS removed_m2,
       (CASE WHEN s.status = 'underwater' THEN 0
             WHEN s.status = 'clipped' THEN s.dry_pieces
             ELSE ST_NGeometries(p.geom) END)::INTEGER AS n_pieces
FROM l_status s JOIN parcels p USING (id)
ORDER BY s.id;

CREATE OR REPLACE TEMP TABLE l_clipped AS
SELECT id, dry AS geom FROM l_status WHERE status = 'clipped';

CREATE OR REPLACE TEMP TABLE l_label AS
SELECT id, lp, label_fallback FROM sfh_label('l_clipped');

-- Clipped lots take the dry geometry and a new label; every other row is copied as it was. The
-- original order of parcels is kept (rowid).
CREATE OR REPLACE TEMP TABLE l_parcels AS
SELECT p.id,
       coalesce(k.geom, p.geom) AS geom,
       CASE WHEN k.id IS NULL THEN p.geom4326
            ELSE ST_Transform(k.geom, 'EPSG:7131', 'EPSG:4326', always_xy := true) END AS geom4326,
       CASE WHEN k.id IS NULL THEN p.label_lng
            ELSE round(ST_X(ST_Transform(l.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7)
       END AS label_lng,
       CASE WHEN k.id IS NULL THEN p.label_lat
            ELSE round(ST_Y(ST_Transform(l.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7)
       END AS label_lat,
       CASE WHEN k.id IS NULL THEN p.x0 ELSE ST_X(l.lp) END AS x0,
       CASE WHEN k.id IS NULL THEN p.y0 ELSE ST_Y(l.lp) END AS y0,
       CASE WHEN k.id IS NULL THEN p.label_fallback ELSE l.label_fallback::INTEGER END
         AS label_fallback,
       p.neighborhood, p.nb_fallback, p.n_parts, p.n_holes,
       p.geom AS geom_orig,
       s.status = 'underwater' AS underwater
FROM parcels p
JOIN l_status s USING (id)
LEFT JOIN l_clipped k USING (id)
LEFT JOIN l_label l USING (id)
ORDER BY p.rowid;

CREATE OR REPLACE TABLE parcels AS SELECT * FROM l_parcels;
ALTER TABLE parcels ADD PRIMARY KEY (id);

-- Lots not wholly inside the union of the z15 tiles read, with or without land features (the mask
-- cannot speak for the rest).
CREATE OR REPLACE TEMP TABLE l_tiles AS
SELECT ST_Union_Agg(
         ST_Transform(ST_MakeEnvelope(w, s, e, n), 'EPSG:4326', 'EPSG:7131', always_xy := true)
         ORDER BY x, y
       ) AS geom
FROM (SELECT DISTINCT x, y, w, s, e, n FROM src_land_tiles WHERE z = 15);

INSERT INTO report_counts
SELECT 'land.tiles', count(*) FROM (SELECT DISTINCT x, y FROM src_land WHERE z = 15);
INSERT INTO report_counts SELECT 'land.mask_area_m2', round(ST_Area(geom), 3) FROM land_mask;
INSERT INTO report_counts SELECT 'land.clipped', count(*) FROM parcel_land WHERE status = 'clipped';
INSERT INTO report_counts
SELECT 'land.underwater', count(*) FROM parcel_land WHERE status = 'underwater';
INSERT INTO report_counts
SELECT 'land.jitter_kept', count(*) FROM parcel_land WHERE status = 'jitter';
INSERT INTO report_counts
SELECT 'land.removed_m2', round(coalesce(list_sum(list(removed_m2 ORDER BY id)), 0), 3)
FROM parcel_land WHERE status = 'clipped';
INSERT INTO report_counts
SELECT 'land.underwater_m2', round(coalesce(list_sum(list(orig_m2 ORDER BY id)), 0), 3)
FROM parcel_land WHERE status = 'underwater';
-- Dry area that only buildings supply, over every lot the clip looked at.
INSERT INTO report_counts
SELECT 'land.building_kept_m2', round(coalesce(list_sum(list(building_m2 ORDER BY id)), 0), 3)
FROM l_status WHERE cand;
INSERT INTO report_counts
SELECT 'land.outside_tiles', count(*)
FROM parcels p, l_tiles t
WHERE t.geom IS NULL OR NOT ST_CoveredBy(p.geom_orig, t.geom);

-- T14 (sd.ts). Idempotent on one database: drop this file's tallies from an earlier run.
DELETE FROM quality_tally WHERE rule_id IN ('sd.parcels.land-clip', 'sd.parcels.underwater');
DELETE FROM quality_sample WHERE rule_id IN ('sd.parcels.land-clip', 'sd.parcels.underwater');
INSERT INTO quality_tally
SELECT 'sd.parcels.land-clip', count(*) FILTER (WHERE status = 'clipped'), count(*), NULL, NULL
FROM parcel_land;
INSERT INTO quality_sample SELECT 'sd.parcels.land-clip', id FROM parcel_land WHERE status = 'clipped';
INSERT INTO quality_tally
SELECT 'sd.parcels.underwater', count(*) FILTER (WHERE status = 'underwater'), count(*), NULL, NULL
FROM parcel_land;
INSERT INTO quality_sample
SELECT 'sd.parcels.underwater', id FROM parcel_land WHERE status = 'underwater';
