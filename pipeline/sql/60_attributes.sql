-- 60_attributes: per-parcel existing attributes (spec §4.5). Reads parcels, parcel_landuse, pieces.
-- Writes parcel_out and floor_area.rule1..4 counts. Ordered by id.
-- floor_area rules: 1 sqft * 0.09290304; 2 sum(piece area * max(1, round(height / floors_m)));
-- 3 units * 80; else 4 = 0. Both floor area and height are rounded to 0.1.

CREATE OR REPLACE TEMP TABLE a_pieces AS
SELECT parcel_id AS id,
       sum(area_m2 * greatest(1, round(height_m / getvariable('floors_m')))) AS fa2,
       max(height_m) AS hmax
FROM pieces WHERE parcel_id IS NOT NULL
GROUP BY parcel_id;

CREATE OR REPLACE TEMP TABLE a_rule AS
SELECT p.id, p.geom, p.label_lng, p.label_lat, p.x0, p.y0, p.neighborhood,
       l.units, l.land_use, l.eligible,
       CASE WHEN l.sqft > 0 THEN l.sqft * 0.09290304
            WHEN coalesce(a.fa2, 0) > 0 THEN a.fa2
            WHEN l.units > 0 THEN l.units * 80.0
            ELSE 0.0 END AS fa,
       CASE WHEN l.sqft > 0 THEN 1
            WHEN coalesce(a.fa2, 0) > 0 THEN 2
            WHEN l.units > 0 THEN 3
            ELSE 4 END AS fa_rule,
       coalesce(a.hmax, 0) AS hmax,
       ST_XMin(p.geom4326) AS xmin, ST_YMin(p.geom4326) AS ymin,
       ST_XMax(p.geom4326) AS xmax, ST_YMax(p.geom4326) AS ymax
FROM parcels p
JOIN parcel_landuse l USING (id)
LEFT JOIN a_pieces a USING (id);

CREATE OR REPLACE TABLE parcel_out AS
SELECT id, geom, label_lng, label_lat, x0, y0,
       units::INTEGER AS units,
       round(fa, 1)::DOUBLE AS floor_area_m2,
       round(hmax, 1)::DOUBLE AS height_m,
       land_use, eligible, neighborhood,
       fa_rule::INTEGER AS fa_rule,
       xmin, ymin, xmax, ymax,
       ST_AsGeoJSON(geom) AS geojson7131,
       ST_Area(geom) AS area_m2
FROM a_rule
ORDER BY id;

INSERT INTO report_counts
SELECT 'floor_area.rule' || k.r, count(o.id)
FROM (SELECT unnest(range(1, 5)) AS r) k LEFT JOIN parcel_out o ON o.fa_rule = k.r
GROUP BY k.r;
