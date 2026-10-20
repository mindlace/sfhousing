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

-- Label points (largest part -> point on surface -> round trip) come from the sfh_label macro
-- (05_macros.sql). p_parts is kept only for the n_holes count below.
CREATE OR REPLACE TEMP TABLE p_parts AS
SELECT id, part FROM (
  SELECT id, struct_extract(d, 'geom') AS part
  FROM (SELECT id, unnest(ST_Dump(geom)) AS d FROM p_valid)
) WHERE ST_GeometryType(part) = 'POLYGON';

CREATE OR REPLACE TEMP TABLE p_label AS
SELECT v.id, v.analysis_neighborhood, v.geom, l.lp, l.label_fallback
FROM p_valid v JOIN sfh_label('p_valid') l USING (id);

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
