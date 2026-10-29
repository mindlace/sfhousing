-- Frontage SQL stage (sim data layers, plan 1 Task 10). Run by runFrontageSql
-- (pipeline/steps/frontage.ts) after the policy step, on a database with parcels (id, geom_orig in
-- EPSG:7131) and src_streets. Writes fr_seg (the street segments a lot can front), fr_probe and
-- fr_cross (the probe lines and the parcels they cross), fr_depth0, fr_adj, fr_cand1, fr_depth1
-- and fr_front (id, seg_idx, depth). Thresholds are SQL_VARS (pipeline/config.ts, all tier 4).
-- Geometry is the DataSF outline (geom_orig), not the land-clipped geom.

-- The part of `lot`'s boundary within `d` + front_tol_m of `seg` (d: the lot's distance to it),
-- lines only. Flat end caps, so a segment does not reach past its own ends.
CREATE OR REPLACE MACRO fr_facing(lot, seg, d) AS
  ST_LineMerge(ST_CollectionExtract(ST_Intersection(
    ST_Boundary(lot),
    ST_Buffer(seg, d + getvariable('front_tol_m'), 8, 'CAP_FLAT', 'JOIN_ROUND', 1.0)
  ), 2));

-- The midpoint of the longest part of a facing edge; ties go to the smaller WKB, so it is
-- deterministic. NULL when the edge is empty.
CREATE OR REPLACE MACRO fr_mid(g) AS
  ST_LineInterpolatePoint(ST_GeomFromHEXWKB(list_sort(list_transform(
    ST_Dump(g), x -> {'l': -ST_Length(x.geom), 'w': ST_AsHEXWKB(x.geom)::VARCHAR}
  ))[1].w), 0.5);

-- Segments: city streets of DataSF classcode 2-5 (major, arterial, collector, residential), not
-- freeways (1), ramps (6) or other (0), and off the paper, private and pseudo layers.
CREATE OR REPLACE TABLE fr_seg AS
SELECT (row_number() OVER (ORDER BY cnn) - 1)::INTEGER AS seg_idx,
       cnn,
       coalesce(streetname, '') AS name,
       classcode AS class,
       ST_Transform(geom, 'EPSG:4326', 'EPSG:7131', always_xy := true) AS geom
FROM src_streets
WHERE classcode IN (2, 3, 4, 5)
  AND coalesce(layer, '') NOT IN ('PAPER', 'PAPER_FWYS', 'PAPER_WATER', 'PRIVATE',
                                  'PRIVATE_PARKING', 'PSEUDO', 'UPROW')
ORDER BY cnn;

-- ---- Depth 0 ----
-- Every (lot, segment) within front_max_m: its facing edge and the probe line from the midpoint
-- of the edge's longest part to the nearest point of the segment. pass 0: these pairs; pass 1
-- (below): the one-lot-deep candidates that have none yet.
CREATE OR REPLACE TABLE fr_probe AS
WITH near AS (
  SELECT p.id, s.seg_idx, s.geom AS seg,
         fr_facing(p.geom_orig, s.geom, ST_Distance(p.geom_orig, s.geom)) AS face
  FROM parcels p
  JOIN fr_seg s ON ST_DWithin(p.geom_orig, s.geom, getvariable('front_max_m'))
),
mid AS (SELECT id, seg_idx, seg, ST_Length(face) AS face_m, fr_mid(face) AS m FROM near)
SELECT id, seg_idx, 0 AS pass, face_m, ST_ShortestLine(m, seg) AS probe
FROM mid;

-- Each other parcel a probe line crosses, and by how much.
CREATE OR REPLACE TABLE fr_cross AS
SELECT pr.id, pr.seg_idx, x.id AS x, ST_Length(ST_Intersection(pr.probe, x.geom_orig)) AS len
FROM fr_probe pr
JOIN parcels x ON ST_Intersects(pr.probe, x.geom_orig)
WHERE x.id <> pr.id;

-- A lot fronts a segment when its facing edge is at least front_min_m and its probe crosses no
-- other parcel by more than occlude_min_m.
CREATE OR REPLACE TABLE fr_depth0 AS
SELECT pr.id, pr.seg_idx
FROM fr_probe pr
WHERE pr.face_m >= getvariable('front_min_m')
  AND NOT EXISTS (
    SELECT 1 FROM fr_cross c
    WHERE c.id = pr.id AND c.seg_idx = pr.seg_idx AND c.len > getvariable('occlude_min_m')
  );

-- ---- Depth 1 (one lot deep) ----
-- Neighbours: lots sharing at least adjacent_min_m of boundary.
CREATE OR REPLACE TABLE fr_adj AS
SELECT a.id AS a, b.id AS b
FROM parcels a
JOIN parcels b ON ST_Intersects(a.geom_orig, b.geom_orig)
WHERE a.id <> b.id
  AND ST_Length(ST_CollectionExtract(
        ST_Intersection(ST_Boundary(a.geom_orig), ST_Boundary(b.geom_orig)), 2
      )) >= getvariable('adjacent_min_m');

-- Candidates: lot B and segment s where a neighbour A fronts s and B does not.
CREATE OR REPLACE TABLE fr_cand1 AS
SELECT DISTINCT j.b AS id, d.seg_idx
FROM fr_depth0 d
JOIN fr_adj j ON j.a = d.id
WHERE NOT EXISTS (SELECT 1 FROM fr_depth0 e WHERE e.id = j.b AND e.seg_idx = d.seg_idx);

-- Probes for the candidates beyond front_max_m (pass 1), as in pass 0 but with no distance limit.
INSERT INTO fr_probe
WITH far AS (
  SELECT c.id, c.seg_idx, s.geom AS seg,
         fr_facing(p.geom_orig, s.geom, ST_Distance(p.geom_orig, s.geom)) AS face
  FROM fr_cand1 c
  JOIN parcels p USING (id)
  JOIN fr_seg s USING (seg_idx)
  WHERE NOT EXISTS (SELECT 1 FROM fr_probe pr WHERE pr.id = c.id AND pr.seg_idx = c.seg_idx)
),
mid AS (SELECT id, seg_idx, seg, ST_Length(face) AS face_m, fr_mid(face) AS m FROM far)
SELECT id, seg_idx, 1 AS pass, face_m, ST_ShortestLine(m, seg) AS probe
FROM mid;

INSERT INTO fr_cross
SELECT pr.id, pr.seg_idx, x.id AS x, ST_Length(ST_Intersection(pr.probe, x.geom_orig)) AS len
FROM fr_probe pr
JOIN parcels x ON ST_Intersects(pr.probe, x.geom_orig)
WHERE pr.pass = 1 AND x.id <> pr.id;

-- B is one lot deep on s when its probe crosses exactly one other parcel by more than
-- occlude_min_m, and that parcel is a neighbour A that fronts s.
CREATE OR REPLACE TABLE fr_depth1 AS
WITH blocking AS (
  SELECT c.id, c.seg_idx, x.x
  FROM fr_cand1 c
  JOIN fr_cross x ON x.id = c.id AND x.seg_idx = c.seg_idx
  WHERE x.len > getvariable('occlude_min_m')
),
one AS (
  SELECT id, seg_idx, min(x) AS a FROM blocking GROUP BY id, seg_idx HAVING count(*) = 1
)
SELECT o.id, o.seg_idx
FROM one o
JOIN fr_adj j ON j.a = o.a AND j.b = o.id
JOIN fr_depth0 d ON d.id = o.a AND d.seg_idx = o.seg_idx;

CREATE OR REPLACE TABLE fr_front AS
SELECT id, seg_idx, depth
FROM (
  SELECT id, seg_idx, 0 AS depth FROM fr_depth0
  UNION ALL
  SELECT id, seg_idx, 1 AS depth FROM fr_depth1
)
ORDER BY id, depth, seg_idx;
