-- 20_landuse: land-use join, orphan reassignment, eligibility. Spec §4.5 (OD-6).
-- Reads src_landuse, parcels. Writes parcel_landuse, landuse_unknown_values and landuse.* counts.
--
-- Count semantics: matched_parcels = parcels with a direct row; no_row_parcels = parcels without one
-- (before reassignment); duplicate_ids = parcels with more than one direct row. has_row is true for
-- direct or reassigned parcels, so land_use = 'NONE' <=> NOT has_row.

-- Known landuse codes: keep identical to KNOWN_LANDUSE in pipeline/config.ts (sql.test.ts checks it).
CREATE OR REPLACE TEMP TABLE lu_known(code VARCHAR);
INSERT INTO lu_known VALUES
  ('RESIDENT'), ('MIXRES'), ('VACANT'), ('MIXED'), ('MIPS'), ('RETAIL/ENT'),
  ('OPENSPACE'), ('CIE'), ('PDR'), ('MED'), ('VISITOR');

CREATE OR REPLACE TABLE landuse_unknown_values AS
SELECT DISTINCT landuse FROM src_landuse
WHERE landuse IS NOT NULL AND landuse NOT IN (SELECT code FROM lu_known)
ORDER BY landuse;

CREATE OR REPLACE TEMP TABLE lu_src AS
SELECT row_number() OVER () AS rid, mapblklot, landuse, resunits, res, totalcomm, geom
FROM src_landuse;

CREATE OR REPLACE TEMP TABLE lu_direct AS
SELECT s.* FROM lu_src s WHERE EXISTS (SELECT 1 FROM parcels p WHERE p.id = s.mapblklot);

CREATE OR REPLACE TEMP TABLE lu_orphan AS
SELECT s.* FROM lu_src s WHERE NOT EXISTS (SELECT 1 FROM parcels p WHERE p.id = s.mapblklot);

-- Active parcel containing each orphan's point on surface (ties -> smallest id).
CREATE OR REPLACE TEMP TABLE lu_orphan_target AS
SELECT o.rid, min(p.id) AS target
FROM lu_orphan o
JOIN parcels p ON ST_Contains(p.geom4326, ST_PointOnSurface(ST_MakeValid(o.geom::GEOMETRY)))
GROUP BY o.rid;

-- Reassign only onto a parcel with no direct row; everything else is dropped (no double counting).
CREATE OR REPLACE TEMP TABLE lu_orphan_class AS
SELECT o.*, t.target,
       (t.target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lu_direct d WHERE d.mapblklot = t.target))
         AS reassigned
FROM lu_orphan o LEFT JOIN lu_orphan_target t USING (rid);

CREATE OR REPLACE TEMP TABLE lu_rows AS
SELECT mapblklot AS id, landuse, resunits, res, totalcomm, FALSE AS reassigned FROM lu_direct
UNION ALL
SELECT target, landuse, resunits, res, totalcomm, TRUE FROM lu_orphan_class WHERE reassigned;

CREATE OR REPLACE TEMP TABLE lu_agg AS
SELECT id,
       sum(coalesce(resunits, 0))::INTEGER AS units,
       sum(coalesce(res, 0) + coalesce(totalcomm, 0)) AS sqft,
       arg_min(coalesce(landuse, 'UNKNOWN'),
               (-(coalesce(res, 0) + coalesce(totalcomm, 0)), landuse IS NULL, landuse)) AS land_use,
       bool_or(reassigned) AS reassigned
FROM lu_rows GROUP BY id;

CREATE OR REPLACE TABLE parcel_landuse AS
SELECT p.id,
       coalesce(a.land_use, 'NONE') AS land_use,
       coalesce(a.units, 0)::INTEGER AS units,
       coalesce(a.sqft, 0)::DOUBLE AS sqft,
       a.id IS NOT NULL AS has_row,
       coalesce(a.land_use, 'NONE') NOT IN ('OPENSPACE', 'NONE') AS eligible,
       coalesce(a.reassigned, FALSE) AS reassigned
FROM parcels p LEFT JOIN lu_agg a ON a.id = p.id;

ALTER TABLE parcel_landuse ADD PRIMARY KEY (id);

INSERT INTO report_counts SELECT 'landuse.rows', count(*) FROM src_landuse;
INSERT INTO report_counts
SELECT 'landuse.matched_parcels', count(DISTINCT mapblklot) FROM lu_direct;
INSERT INTO report_counts
SELECT 'landuse.no_row_parcels', count(*) FROM parcels p
WHERE NOT EXISTS (SELECT 1 FROM lu_direct d WHERE d.mapblklot = p.id);
INSERT INTO report_counts SELECT 'landuse.orphan_rows', count(*) FROM lu_orphan;
INSERT INTO report_counts
SELECT 'landuse.orphan_reassigned', count(*) FROM lu_orphan_class WHERE reassigned;
INSERT INTO report_counts
SELECT 'landuse.orphan_dropped', count(*) FROM lu_orphan_class WHERE NOT reassigned;
INSERT INTO report_counts
SELECT 'landuse.orphan_reassigned_units', coalesce(sum(coalesce(resunits, 0)), 0)
FROM lu_orphan_class WHERE reassigned;
INSERT INTO report_counts
SELECT 'landuse.orphan_dropped_units', coalesce(sum(coalesce(resunits, 0)), 0)
FROM lu_orphan_class WHERE NOT reassigned;
INSERT INTO report_counts
SELECT 'landuse.duplicate_ids', count(*)
FROM (SELECT mapblklot FROM lu_direct GROUP BY mapblklot HAVING count(*) > 1);
INSERT INTO report_counts SELECT 'landuse.unknown_values', count(*) FROM landuse_unknown_values;

-- Parcels per final class: every known class (plus UNKNOWN, NONE) even when empty, plus any stray value.
INSERT INTO report_counts
SELECT 'landuse.class.' || c.code, count(pl.id)
FROM (SELECT code FROM lu_known UNION SELECT 'UNKNOWN' UNION SELECT 'NONE'
      UNION SELECT land_use FROM parcel_landuse) c
LEFT JOIN parcel_landuse pl ON pl.land_use = c.code
GROUP BY c.code;
