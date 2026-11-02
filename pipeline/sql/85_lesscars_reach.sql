-- /lesscars stop reach (Task 7). Run by pipeline/steps/lesscars-sql.ts (reachLessCars) after the
-- policy step and carveFreedLand, on a database with parcels (geom_orig), lc_site and lc_stops.
-- lc_stops(id, tier, lng, lat, parcels): the stops whose SB 79 tier the plan improves (parcels =
-- true), plus, for freed sites only, every other stop tiered on any day (parcels = false). A
-- stop may appear once per tier it reaches; its distance does not depend on the tier.
-- Writes lc_reach(id, stop_id, dist_m): per parcel (from the DataSF outline, geom_orig, as
-- pol_tod) or freed piece (lc_site, by site_id), the distance in metres to each such stop within
-- ½ mile (tod_half_m). Parcels reach only parcels = true stops: pol_tod already holds today's.
CREATE OR REPLACE TABLE lc_stop_pts AS
SELECT id, bool_or(parcels) AS parcels,
       ST_Transform(ST_Point(any_value(lng), any_value(lat)), 'EPSG:4326', 'EPSG:7131',
                    always_xy := true) AS geom
FROM lc_stops
GROUP BY id;

CREATE OR REPLACE TABLE lc_reach AS
SELECT p.id, s.id AS stop_id, ST_Distance(p.geom_orig, s.geom) AS dist_m
FROM parcels p
JOIN lc_stop_pts s ON s.parcels AND ST_DWithin(p.geom_orig, s.geom, getvariable('tod_half_m'))
UNION ALL
SELECT x.site_id AS id, s.id AS stop_id, ST_Distance(x.geom, s.geom) AS dist_m
FROM (SELECT site_id, ST_GeomFromGeoJSON(geojson7131) AS geom FROM lc_site) x
JOIN lc_stop_pts s ON ST_DWithin(x.geom, s.geom, getvariable('tod_half_m'))
ORDER BY id, stop_id;
