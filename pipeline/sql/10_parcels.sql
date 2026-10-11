-- 10_parcels: one record per active mapblklot, in EPSG:7131, with a label point and a neighborhood.
-- Spec §4.4. Reads src_parcels, src_neighborhoods. Writes parcels, nb7131 and parcels.* counts.

CREATE OR REPLACE TABLE nb7131 AS
SELECT nhood,
       ST_Transform(ST_MakeValid(geom::GEOMETRY), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS geom
FROM src_neighborhoods;

CREATE OR REPLACE TEMP TABLE p_active AS
SELECT * FROM src_parcels WHERE active AND mapblklot IS NOT NULL;

-- One row per mapblklot: blklot = mapblklot first, else the smallest blklot.
CREATE OR REPLACE TEMP TABLE p_chosen AS
SELECT mapblklot, blklot, analysis_neighborhood, geom FROM (
  SELECT *, row_number() OVER (
    PARTITION BY mapblklot ORDER BY (blklot = mapblklot) DESC, blklot
  ) AS rn
  FROM p_active
) WHERE rn = 1;

CREATE OR REPLACE TEMP TABLE p_valid AS
SELECT mapblklot AS id, analysis_neighborhood,
       ST_Transform(ST_MakeValid(geom::GEOMETRY), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS geom
FROM p_chosen;

-- Largest part (7131) -> point on surface -> 4326 -> round 1e-7 -> back to 7131.
CREATE OR REPLACE TEMP TABLE p_parts AS
SELECT id, part, ST_Area(part) AS area FROM (
  SELECT id, unnest(ST_Dump(geom)).geom AS part FROM p_valid
) WHERE ST_GeometryType(part) = 'POLYGON';

CREATE OR REPLACE TEMP TABLE p_largest AS
SELECT id, part FROM (
  SELECT *, row_number() OVER (PARTITION BY id ORDER BY area DESC) AS rn FROM p_parts
) WHERE rn = 1;

CREATE OR REPLACE TEMP TABLE p_label0 AS
SELECT v.id, v.analysis_neighborhood, v.geom, l.part,
       ST_PointOnSurface(l.part) AS pt
FROM p_valid v JOIN p_largest l USING (id);

-- Round-trip a 7131 point through 4326 rounded to 1e-7 degrees.
CREATE OR REPLACE TEMP MACRO round_trip(pt) AS (
  SELECT ST_Transform(
    ST_Point(
      round(ST_X(ST_Transform(pt, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7),
      round(ST_Y(ST_Transform(pt, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7)
    ), 'EPSG:4326', 'EPSG:7131', always_xy := true)
);

CREATE OR REPLACE TEMP TABLE p_label1 AS
SELECT *, round_trip(pt) AS rpt FROM p_label0;

CREATE OR REPLACE TEMP TABLE p_label2 AS
SELECT *,
       ST_Contains(geom, rpt) AS ok1,
       ST_PointOnSurface(ST_Buffer(part, -0.05)) AS pt2
FROM p_label1;

CREATE OR REPLACE TEMP TABLE p_label3 AS
SELECT *,
       CASE WHEN ok1 THEN rpt ELSE round_trip(pt2) END AS rpt2
FROM p_label2;

CREATE OR REPLACE TEMP TABLE p_label AS
SELECT id, analysis_neighborhood, geom,
       CASE WHEN ok1 THEN rpt
            WHEN pt2 IS NOT NULL AND NOT ST_IsEmpty(pt2) AND ST_Contains(geom, rpt2) THEN rpt2
            ELSE rpt END AS lp,
       CASE WHEN ok1 THEN 0
            WHEN pt2 IS NOT NULL AND NOT ST_IsEmpty(pt2) AND ST_Contains(geom, rpt2) THEN 1
            ELSE 2 END AS label_fallback
FROM p_label3;

-- Containing neighborhood polygon (ties broken by name) for parcels without analysis_neighborhood.
CREATE OR REPLACE TEMP TABLE p_nb AS
SELECT l.id, min(n.nhood) AS nhood
FROM p_label l JOIN nb7131 n ON ST_Contains(n.geom, l.lp)
WHERE l.analysis_neighborhood IS NULL
GROUP BY l.id;

CREATE OR REPLACE TABLE parcels AS
SELECT l.id,
       l.geom,
       ST_Transform(l.geom, 'EPSG:7131', 'EPSG:4326', always_xy := true) AS geom4326,
       round(ST_X(ST_Transform(l.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7) AS label_lng,
       round(ST_Y(ST_Transform(l.lp, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7) AS label_lat,
       ST_X(l.lp) AS x0,
       ST_Y(l.lp) AS y0,
       l.label_fallback::INTEGER AS label_fallback,
       coalesce(l.analysis_neighborhood, nb.nhood) AS neighborhood,
       (l.analysis_neighborhood IS NULL AND nb.nhood IS NOT NULL) AS nb_fallback,
       ST_NGeometries(l.geom)::INTEGER AS n_parts,
       (SELECT coalesce(sum(ST_NumInteriorRings(pp.part)), 0)
        FROM p_parts pp WHERE pp.id = l.id)::INTEGER AS n_holes
FROM p_label l
LEFT JOIN p_nb nb ON nb.id = l.id AND l.analysis_neighborhood IS NULL;

ALTER TABLE parcels ADD PRIMARY KEY (id);

INSERT INTO report_counts
SELECT 'parcels.null_id_dropped', count(*) FROM src_parcels WHERE active AND mapblklot IS NULL;
INSERT INTO report_counts
SELECT 'parcels.active_rows', count(*) FROM p_active;
INSERT INTO report_counts
SELECT 'parcels.condo_sublots', count(*) FROM p_active WHERE blklot <> mapblklot;
INSERT INTO report_counts
SELECT 'parcels.condo_geom_mismatch', count(*)
FROM p_active a JOIN p_chosen c USING (mapblklot)
WHERE a.blklot <> c.blklot AND NOT ST_Equals(a.geom, c.geom);
INSERT INTO report_counts
SELECT 'parcels.distinct_active_ids', count(DISTINCT mapblklot)
FROM src_parcels WHERE active AND mapblklot IS NOT NULL;
INSERT INTO report_counts SELECT 'parcels.emitted', count(*) FROM parcels;
INSERT INTO report_counts SELECT 'parcels.multipart', count(*) FROM parcels WHERE n_parts > 1;
INSERT INTO report_counts SELECT 'parcels.holed', count(*) FROM parcels WHERE n_holes > 0;
INSERT INTO report_counts
SELECT 'parcels.label_buffer_fallback', count(*) FROM parcels WHERE label_fallback = 1;
INSERT INTO report_counts
SELECT 'parcels.label_warning', count(*) FROM parcels WHERE label_fallback = 2;
INSERT INTO report_counts
SELECT 'parcels.nb_spatial_fallback', count(*) FROM parcels WHERE nb_fallback;
INSERT INTO report_counts
SELECT 'parcels.no_neighborhood', count(*) FROM parcels WHERE neighborhood IS NULL;
