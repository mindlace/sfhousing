-- 84_lesscars_sites: freed land. Removed street and highway right-of-way cut into new building
-- sites (docs/superpowers/specs/2026-11-01-lesscars-design.md "Freed land"). Run by
-- pipeline/steps/lesscars-sql.ts (carveFreedLand), not by runSql, after runSql (05_macros for
-- sfh_label; 45_land for land_mask and parcels.geom_orig). Reads src_streets, land_mask, parcels
-- and three input tables the TS step writes first: lc_in (project_id, ord, row_half_m), lc_in_cnn
-- (project_id, cnn) and lc_in_line (project_id, li, wkt: a LINESTRING in lng/lat), plus the
-- freed-parcel inputs below. Variables (pipeline/lesscars-config.ts LC): lc_keep_half_m,
-- lc_access_m, lc_lot_max_m, lc_min_piece_m2, lc_neighbour_m. Writes lc_site and
-- lc_site_neighbour. Every aggregate over geometry is ordered,
-- so the result does not depend on scan order.
--
-- Builder's call (the spec says only "removed right-of-way becomes new parcels"): freed land is
-- carved from the current parcels and the land mask, with no right-of-way source. It is exact
-- against both and needs no extra source:
--   freed = (land_mask − ∪ buffer(parcel outline, accessM)) ∩ buffer(removed lines, rowHalfWidthM)
--           − ∪ buffer(every other centreline, keepHalfM)
-- keeping the connected parts that touch a removed line, cut across the line at no more than
-- lotMaxM along it, and dropping pieces under minPieceM2.
-- Further builder's calls:
-- - A project's removed lines are merged (ST_LineMerge) before buffering, and the buffer has flat
--   ends, so a truncation frees nothing beyond its own stretch and consecutive CNNs leave no gap.
-- - Parcels are buffered by their original outline (geom_orig), the larger of the two shapes.
-- - "Every other centreline" is every src_streets row whose CNN no removal in this run names. A
--   removal given as a drawn line over a live street does not remove that street's corridor.
-- - Bands of different projects never share land: a project loses what an earlier one (lc_in.ord)
--   already frees.
-- - Each line is cut into ceil((length - 1 mm) / lotMaxM) equal stretches (so every stretch is
--   at most lotMaxM, give or take 1 mm). The 1 mm absorbs projection noise: a 60 m line measures
--   60.0000000007 m and would otherwise be cut in two. Each stretch owns the flat-ended buffer
--   round it, less those of earlier stretches; the wedges no stretch covers at a bend go to the
--   nearest stretch.
-- - Pieces are numbered k = 1, 2, … per project along the merged lines (line, stretch), then by
--   centroid x, y.
-- - Neighbours: parcels (current outline) within lc_neighbour_m of the piece; with none, the
--   nearest parcel (smaller id on a tie). Never a parcel of lc_in_not_neighbour (freeway land).
-- Freed parcels (lesscars v1.1; input lc_in_parcel (project_id, parcel_id, held_by) and
-- lc_in_not_neighbour (parcel_id), variables lc_merge_m and lc_overlap_m2): they get no access
-- strip and are subtracted from the ROW; each polygon part of one is a seed site, and a ROW piece
-- within lc_merge_m of a non-held seed of its project merges into the seed it shares most land
-- with inside lc_merge_m (smaller parcel id, then part). k: seeds by (parcel id, part), then the
-- unmerged pieces of at least lc_min_piece_m2 in v1 order. lc_site gains parcels (freed parcels
-- overlapped by more than lc_overlap_m2, sorted), parcel_m2 and held_by.

CREATE OR REPLACE TEMP TABLE lc_raw_line AS
SELECT i.project_id, s.geom
FROM lc_in_cnn i JOIN src_streets s USING (cnn)
UNION ALL
SELECT project_id,
       ST_Transform(ST_GeomFromText(wkt), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS geom
FROM lc_in_line;

-- One row per merged linestring of a project; lid in a stable order.
CREATE OR REPLACE TEMP TABLE lc_line AS
WITH m AS (
  SELECT project_id, ST_LineMerge(ST_Union_Agg(geom ORDER BY ST_AsHEXWKB(geom))) AS g
  FROM lc_raw_line GROUP BY project_id
),
d AS (
  SELECT project_id, struct_extract(x, 'geom') AS geom
  FROM (SELECT project_id, unnest(ST_Dump(g)) AS x FROM m)
)
SELECT d.project_id, i.row_half_m,
       row_number() OVER (
         PARTITION BY d.project_id ORDER BY ST_XMin(d.geom), ST_YMin(d.geom), ST_AsHEXWKB(d.geom)
       )::INTEGER AS lid,
       d.geom, ST_Length(d.geom) AS len
FROM d JOIN lc_in i USING (project_id)
WHERE ST_GeometryType(d.geom) = 'LINESTRING' AND ST_Length(d.geom) > 0;

CREATE OR REPLACE TEMP TABLE lc_band0 AS
SELECT l.project_id, i.ord,
       ST_Union_Agg(
         ST_Buffer(l.geom, l.row_half_m, 8, 'CAP_FLAT', 'JOIN_ROUND', 5.0) ORDER BY l.lid
       ) AS geom
FROM lc_line l JOIN lc_in i USING (project_id)
GROUP BY l.project_id, i.ord;

CREATE OR REPLACE TEMP TABLE lc_band AS
SELECT b.project_id, b.ord,
       CASE WHEN e.u IS NULL THEN b.geom ELSE ST_Difference(b.geom, e.u) END AS geom
FROM lc_band0 b
LEFT JOIN (
  SELECT b.project_id, ST_Union_Agg(o.geom ORDER BY o.ord) AS u
  FROM lc_band0 b JOIN lc_band0 o ON o.ord < b.ord AND ST_Intersects(o.geom, b.geom)
  GROUP BY b.project_id
) e USING (project_id);

-- The access strip round every parcel near the band but the freed ones, and the corridor of every
-- kept centreline.
CREATE OR REPLACE TEMP TABLE lc_access AS
SELECT b.project_id,
       ST_Union_Agg(ST_Buffer(p.geom_orig, getvariable('lc_access_m')) ORDER BY p.id) AS u
FROM lc_band b
JOIN parcels p
  ON ST_DWithin(p.geom_orig, b.geom, getvariable('lc_access_m'))
 AND p.id NOT IN (SELECT parcel_id FROM lc_in_parcel)
GROUP BY b.project_id;

-- Every freed parcel (current outline): never ROW land; it becomes sites of its own.
CREATE OR REPLACE TEMP TABLE lc_freed AS
SELECT ST_Union_Agg(p.geom ORDER BY p.id) AS u
FROM parcels p JOIN lc_in_parcel i ON i.parcel_id = p.id;

CREATE OR REPLACE TEMP TABLE lc_kept AS
SELECT b.project_id,
       ST_Union_Agg(
         ST_Buffer(s.geom, getvariable('lc_keep_half_m')) ORDER BY s.cnn, ST_AsHEXWKB(s.geom)
       ) AS u
FROM lc_band b
JOIN src_streets s
  ON s.geom IS NOT NULL
 AND s.cnn NOT IN (SELECT cnn FROM lc_in_cnn)
 AND ST_DWithin(s.geom, b.geom, getvariable('lc_keep_half_m'))
GROUP BY b.project_id;

CREATE OR REPLACE TEMP TABLE lc_free0 AS
SELECT b.project_id,
       ST_CollectionExtract(
         ST_Difference(
           ST_Difference(
             ST_CollectionExtract(ST_Intersection(b.geom, m.geom), 3),
             coalesce(a.u, ST_GeomFromText('POLYGON EMPTY'))
           ),
           coalesce(k.u, ST_GeomFromText('POLYGON EMPTY'))
         ),
         3
       ) AS geom
FROM lc_band b
CROSS JOIN land_mask m
LEFT JOIN lc_access a USING (project_id)
LEFT JOIN lc_kept k USING (project_id);

-- Less the freed parcels; a run that frees none keeps the v1 geometry exactly.
CREATE OR REPLACE TEMP TABLE lc_free AS
SELECT f.project_id,
       CASE WHEN r.u IS NULL OR NOT ST_Intersects(f.geom, r.u) THEN f.geom
            ELSE ST_CollectionExtract(ST_Difference(f.geom, r.u), 3) END AS geom
FROM lc_free0 f CROSS JOIN lc_freed r;

-- Connected parts that touch a removed line.
CREATE OR REPLACE TEMP TABLE lc_part AS
WITH d AS (
  SELECT project_id, struct_extract(x, 'geom') AS geom, struct_extract(x, 'path') AS path
  FROM (SELECT project_id, unnest(ST_Dump(geom)) AS x FROM lc_free WHERE NOT ST_IsEmpty(geom))
)
SELECT project_id, row_number() OVER (PARTITION BY project_id ORDER BY path)::INTEGER AS pid, geom
FROM d
WHERE ST_GeometryType(geom) = 'POLYGON'
  AND EXISTS (
    SELECT 1 FROM lc_line l WHERE l.project_id = d.project_id AND ST_Intersects(l.geom, d.geom)
  );

-- Stretches of at most lc_lot_max_m along each line, and the cell each owns (1 m wider than the
-- band, so no band edge falls outside it).
CREATE OR REPLACE TEMP TABLE lc_stretch AS
WITH n AS (
  SELECT *, greatest(1, ceil((len - 0.001) / getvariable('lc_lot_max_m')))::INTEGER AS n
  FROM lc_line
),
c AS (SELECT *, unnest(range(n)) AS ci FROM n)
SELECT project_id, lid, ci::INTEGER AS ci, row_half_m,
       ST_LineSubstring(geom, ci::DOUBLE / n, (ci + 1)::DOUBLE / n) AS chunk
FROM c;

CREATE OR REPLACE TEMP TABLE lc_cell0 AS
SELECT *, ST_Buffer(chunk, row_half_m + 1, 8, 'CAP_FLAT', 'JOIN_ROUND', 5.0) AS cell
FROM lc_stretch;

CREATE OR REPLACE TEMP TABLE lc_cell AS
SELECT c.project_id, c.lid, c.ci, c.chunk,
       CASE WHEN e.u IS NULL THEN c.cell ELSE ST_Difference(c.cell, e.u) END AS cell
FROM lc_cell0 c
LEFT JOIN (
  SELECT c.project_id, c.lid, c.ci, ST_Union_Agg(o.cell ORDER BY o.lid, o.ci) AS u
  FROM lc_cell0 c
  JOIN lc_cell0 o
    ON o.project_id = c.project_id
   AND (o.lid < c.lid OR (o.lid = c.lid AND o.ci < c.ci))
   AND ST_Intersects(o.cell, c.cell)
  GROUP BY c.project_id, c.lid, c.ci
) e USING (project_id, lid, ci);

-- Each part cut by the cells, plus the wedges no cell covers, each given to its nearest stretch.
CREATE OR REPLACE TEMP TABLE lc_cut AS
SELECT p.project_id, p.pid, c.lid, c.ci,
       ST_CollectionExtract(ST_Intersection(p.geom, c.cell), 3) AS geom
FROM lc_part p JOIN lc_cell c ON c.project_id = p.project_id AND ST_Intersects(p.geom, c.cell);

CREATE OR REPLACE TEMP TABLE lc_left AS
WITH u AS (
  SELECT p.project_id, p.pid, p.geom,
         (SELECT ST_Union_Agg(c.cell ORDER BY c.lid, c.ci) FROM lc_cell c
          WHERE c.project_id = p.project_id) AS cells
  FROM lc_part p
),
r AS (
  SELECT project_id, pid,
         ST_CollectionExtract(
           CASE WHEN cells IS NULL THEN geom ELSE ST_Difference(geom, cells) END, 3
         ) AS geom
  FROM u
),
d AS (
  SELECT project_id, pid, struct_extract(x, 'geom') AS geom, struct_extract(x, 'path') AS path
  FROM (SELECT project_id, pid, unnest(ST_Dump(geom)) AS x FROM r WHERE NOT ST_IsEmpty(geom))
)
SELECT d.project_id, d.pid, s.lid, s.ci, d.geom
FROM d JOIN lc_stretch s ON s.project_id = d.project_id
WHERE ST_GeometryType(d.geom) = 'POLYGON'
QUALIFY row_number() OVER (
  PARTITION BY d.project_id, d.pid, d.path ORDER BY ST_Distance(d.geom, s.chunk), s.lid, s.ci
) = 1;

-- Every ROW piece, in v1 order (vk), before the merge and the size filter.
CREATE OR REPLACE TEMP TABLE lc_piece0 AS
WITH g AS (
  SELECT project_id, pid, lid, ci,
         ST_CollectionExtract(ST_Union_Agg(geom ORDER BY src, ST_AsHEXWKB(geom)), 3) AS geom
  FROM (
    SELECT project_id, pid, lid, ci, 0 AS src, geom FROM lc_cut WHERE NOT ST_IsEmpty(geom)
    UNION ALL
    SELECT project_id, pid, lid, ci, 1, geom FROM lc_left
  )
  GROUP BY project_id, pid, lid, ci
),
d AS (
  SELECT project_id, lid, ci, struct_extract(x, 'geom') AS geom
  FROM (SELECT project_id, lid, ci, unnest(ST_Dump(geom)) AS x FROM g WHERE NOT ST_IsEmpty(geom))
)
SELECT project_id, geom, ST_Area(geom) AS area_m2,
       row_number() OVER (
         PARTITION BY project_id
         ORDER BY lid, ci, ST_X(ST_Centroid(geom)), ST_Y(ST_Centroid(geom)), ST_AsHEXWKB(geom)
       )::INTEGER AS vk
FROM d
WHERE ST_GeometryType(geom) = 'POLYGON';

-- Seeds: each polygon part of each freed parcel (current outline).
CREATE OR REPLACE TEMP TABLE lc_seed AS
WITH d AS (
  SELECT i.project_id, i.parcel_id, i.held_by, struct_extract(x, 'geom') AS geom,
         struct_extract(x, 'path') AS path
  FROM (
    SELECT i.project_id, i.parcel_id, i.held_by, unnest(ST_Dump(p.geom)) AS x
    FROM lc_in_parcel i JOIN parcels p ON p.id = i.parcel_id
  ) i
)
SELECT project_id, parcel_id, held_by, geom,
       row_number() OVER (PARTITION BY parcel_id ORDER BY path)::INTEGER AS part
FROM d
WHERE ST_GeometryType(geom) = 'POLYGON' AND NOT ST_IsEmpty(geom);

-- A ROW piece within lc_merge_m of a seed of a non-held parcel of its project joins the seed it
-- shares the most land with inside that tolerance (smaller parcel id, then part, on a tie).
CREATE OR REPLACE TEMP TABLE lc_merge AS
SELECT pc.project_id, pc.vk, s.parcel_id, s.part
FROM lc_piece0 pc
JOIN lc_seed s
  ON s.project_id = pc.project_id
 AND s.held_by IS NULL
 AND ST_DWithin(pc.geom, s.geom, getvariable('lc_merge_m'))
QUALIFY row_number() OVER (
  PARTITION BY pc.project_id, pc.vk
  ORDER BY ST_Area(ST_Intersection(pc.geom, ST_Buffer(s.geom, getvariable('lc_merge_m')))) DESC,
           s.parcel_id, s.part
) = 1;

-- Sites: seeds (with the pieces merged into them) by (parcel id, part), then the unmerged pieces
-- of at least lc_min_piece_m2 in v1 order.
CREATE OR REPLACE TEMP TABLE lc_piece AS
WITH seed AS (
  SELECT s.project_id, s.parcel_id, s.part, s.held_by,
         row_number() OVER (PARTITION BY s.project_id ORDER BY s.parcel_id, s.part)::INTEGER AS k,
         ST_CollectionExtract(
           ST_Union_Agg(u.geom ORDER BY u.src, u.vk), 3
         ) AS geom
  FROM lc_seed s
  JOIN (
    SELECT project_id, parcel_id, part, 0 AS src, 0 AS vk, geom FROM lc_seed
    UNION ALL
    SELECT m.project_id, m.parcel_id, m.part, 1, m.vk, pc.geom
    FROM lc_merge m JOIN lc_piece0 pc USING (project_id, vk)
  ) u USING (project_id, parcel_id, part)
  GROUP BY s.project_id, s.parcel_id, s.part, s.held_by
),
n AS (SELECT project_id, count(*)::INTEGER AS n FROM lc_seed GROUP BY project_id),
piece AS (
  SELECT pc.project_id, pc.geom,
         coalesce(n.n, 0) + row_number() OVER (PARTITION BY pc.project_id ORDER BY pc.vk)::INTEGER
           AS k
  FROM lc_piece0 pc
  LEFT JOIN n USING (project_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM lc_merge m WHERE m.project_id = pc.project_id AND m.vk = pc.vk
  )
    AND pc.area_m2 >= getvariable('lc_min_piece_m2')
),
k AS (
  SELECT project_id, k, held_by, geom FROM seed
  UNION ALL
  SELECT project_id, k, NULL, geom FROM piece
)
SELECT 'lc:' || project_id || ':' || k AS site_id, project_id, k, ST_Area(geom) AS area_m2,
       held_by, geom
FROM k;

-- The freed parcels each site overlaps by more than lc_overlap_m2, and the land it has in them.
CREATE OR REPLACE TEMP TABLE lc_piece_parcel AS
SELECT s.site_id,
       list(i.parcel_id ORDER BY i.parcel_id) AS parcels,
       sum(ST_Area(ST_Intersection(s.geom, p.geom))) AS parcel_m2
FROM lc_piece s
JOIN lc_in_parcel i ON true
JOIN parcels p ON p.id = i.parcel_id AND ST_Intersects(s.geom, p.geom)
WHERE ST_Area(ST_Intersection(s.geom, p.geom)) > getvariable('lc_overlap_m2')
GROUP BY s.site_id;

CREATE OR REPLACE TEMP TABLE lc_piece_lbl AS SELECT site_id AS id, geom FROM lc_piece;

CREATE OR REPLACE TABLE lc_site AS
SELECT s.site_id, s.project_id, s.k, s.area_m2,
       coalesce(pp.parcels, []::VARCHAR[]) AS parcels,
       coalesce(pp.parcel_m2, 0)::DOUBLE AS parcel_m2,
       s.held_by,
       ST_X(l.lp) AS x0, ST_Y(l.lp) AS y0,
       round(ST_X(ST_Transform(l.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7) AS lng,
       round(ST_Y(ST_Transform(l.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7) AS lat,
       ST_AsGeoJSON(s.geom) AS geojson7131,
       ST_AsGeoJSON(ST_Transform(s.geom, 'EPSG:7131', 'EPSG:4326', always_xy := true))
         AS geojson4326
FROM lc_piece s
JOIN sfh_label('lc_piece_lbl') l ON l.id = s.site_id
LEFT JOIN lc_piece_parcel pp USING (site_id)
ORDER BY s.site_id;

-- Neighbours: never freeway land (lc_in_not_neighbour: the catalog and every freed parcel).
CREATE OR REPLACE TEMP TABLE lc_nb_parcel AS
SELECT id, geom FROM parcels WHERE id NOT IN (SELECT parcel_id FROM lc_in_not_neighbour);

CREATE OR REPLACE TABLE lc_site_neighbour AS
WITH near AS (
  SELECT s.site_id, p.id AS parcel_id, ST_Distance(s.geom, p.geom) AS dist_m
  FROM lc_piece s JOIN lc_nb_parcel p ON ST_DWithin(s.geom, p.geom, getvariable('lc_neighbour_m'))
),
lone AS (
  SELECT s.site_id, p.id AS parcel_id, ST_Distance(s.geom, p.geom) AS dist_m
  FROM lc_piece s, lc_nb_parcel p
  WHERE s.site_id NOT IN (SELECT site_id FROM near)
  QUALIFY row_number() OVER (PARTITION BY s.site_id ORDER BY ST_Distance(s.geom, p.geom), p.id) = 1
)
SELECT site_id, parcel_id, dist_m FROM (SELECT * FROM near UNION ALL SELECT * FROM lone)
ORDER BY site_id, parcel_id;
