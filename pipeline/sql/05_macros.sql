-- 05_macros: shared TEMP macros. Run before every other SQL file, on the same connection.
-- Form used: sfh_label is a TABLE macro over query_table(src) (DuckDB accepts it; no scalar
-- fallback was needed). Call it with the table name as a string literal:
--   SELECT id, lp, label_fallback FROM sfh_label('some_table');
-- 'some_table' (any table, TEMP table or view) needs columns (id, geom) with geom a GEOMETRY in
-- EPSG:7131. To label a subset, materialise it first (CREATE TEMP TABLE t AS SELECT id, geom ...).
-- Returns (id, lp GEOMETRY, label_fallback INTEGER); ids without a polygon part are dropped.

-- Round-trip a 7131 point through 4326 rounded to 1e-7 degrees.
CREATE OR REPLACE TEMP MACRO round_trip(pt) AS (
  SELECT ST_Transform(
    ST_Point(
      round(ST_X(ST_Transform(pt, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7),
      round(ST_Y(ST_Transform(pt, 'EPSG:7131', 'EPSG:4326', always_xy := true)), 7)
    ), 'EPSG:4326', 'EPSG:7131', always_xy := true)
);

-- Largest part (7131) -> point on surface -> 4326 -> round 1e-7 -> back to 7131, falling back to a
-- point on the -0.05 m buffered part. label_fallback: 0 direct, 1 buffer fallback, 2 unlabelled
-- (the rounded direct point is kept). part_path (the ST_Dump path) breaks ties between equal-area
-- parts deterministically.
CREATE OR REPLACE TEMP MACRO sfh_label(src) AS TABLE
WITH parts AS (
  SELECT id, geom, part, part_path, ST_Area(part) AS area FROM (
    SELECT id, geom, struct_extract(d, 'geom') AS part, struct_extract(d, 'path') AS part_path
    FROM (SELECT id, geom, unnest(ST_Dump(geom)) AS d FROM query_table(src))
  ) WHERE ST_GeometryType(part) = 'POLYGON'
),
largest AS (
  SELECT id, geom, part FROM (
    SELECT *, row_number() OVER (PARTITION BY id ORDER BY area DESC, part_path) AS rn FROM parts
  ) WHERE rn = 1
),
label0 AS (
  SELECT id, geom, part, ST_PointOnSurface(part) AS pt FROM largest
),
label1 AS (
  SELECT *, round_trip(pt) AS rpt FROM label0
),
label2 AS (
  SELECT *, ST_Contains(geom, rpt) AS ok1,
         ST_PointOnSurface(ST_Buffer(part, -0.05)) AS pt2
  FROM label1
),
label3 AS (
  SELECT *, CASE WHEN ok1 THEN rpt ELSE round_trip(pt2) END AS rpt2 FROM label2
)
SELECT id,
       CASE WHEN ok1 THEN rpt
            WHEN pt2 IS NOT NULL AND NOT ST_IsEmpty(pt2) AND ST_Contains(geom, rpt2) THEN rpt2
            ELSE rpt END AS lp,
       (CASE WHEN ok1 THEN 0
             WHEN pt2 IS NOT NULL AND NOT ST_IsEmpty(pt2) AND ST_Contains(geom, rpt2) THEN 1
             ELSE 2 END)::INTEGER AS label_fallback
FROM label3;
