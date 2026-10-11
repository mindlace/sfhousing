-- 30_buildings: Overture buildings in EPSG:7131, minus underground and out-of-city. Spec §4.6.
-- Reads src_overture, nb7131. Writes b_base (temp) and buildings.input/underground_dropped/outside_nb_dropped counts.
-- Note: renderSource 'datasf' would swap in 30_buildings_datasf.sql; not built in M1 (runSql throws).

CREATE OR REPLACE TEMP TABLE b_nb_union AS
SELECT ST_Union_Agg(geom) AS geom FROM nb7131;

CREATE OR REPLACE TEMP TABLE b_all AS
SELECT id AS bid, height, num_floors, min_height, datasets, coalesce(is_underground, FALSE) AS is_underground,
       ST_CollectionExtract(
         ST_MakeValid(ST_Transform(geom::GEOMETRY, 'EPSG:4326', 'EPSG:7131', always_xy := true)), 3
       ) AS geom
FROM src_overture;

CREATE OR REPLACE TEMP TABLE b_flagged AS
SELECT a.*,
       (NOT a.is_underground AND NOT ST_IsEmpty(a.geom)
        AND ST_Within(ST_PointOnSurface(a.geom), u.geom)) AS inside_nb
FROM b_all a, b_nb_union u;

CREATE OR REPLACE TEMP TABLE b_base AS
SELECT bid, height, num_floors, min_height, datasets, geom
FROM b_flagged WHERE inside_nb
ORDER BY bid;

INSERT INTO report_counts SELECT 'buildings.input', count(*) FROM src_overture;
INSERT INTO report_counts
SELECT 'buildings.underground_dropped', count(*) FROM b_flagged WHERE is_underground;
INSERT INTO report_counts
SELECT 'buildings.outside_nb_dropped', count(*) FROM b_flagged WHERE NOT is_underground AND NOT inside_nb;
