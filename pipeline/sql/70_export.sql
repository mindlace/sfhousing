-- 70_export: tables the artifact writers read. Reads pieces, nb7131, buildings.
-- Writes buildings_export, neighborhoods_out, overture_contrib.
-- Optional roof export attaches piece_id/building_id after this stage, without altering
-- these fallback dimensions or the parcel_out records computed in 60_attributes.

CREATE OR REPLACE TABLE buildings_export AS
SELECT parcel_id, bid, height_m, base_m, hs,
       ST_AsGeoJSON(ST_Transform(geom, 'EPSG:7131', 'EPSG:4326', always_xy := true)) AS geojson4326
FROM pieces
ORDER BY parcel_id NULLS LAST, bid;

-- Simplified in metres (7131), then 4326 with coordinates snapped to 1e-6 degrees.
CREATE OR REPLACE TABLE neighborhoods_out AS
SELECT nhood AS name,
       ST_AsGeoJSON(ST_ReducePrecision(
         ST_Transform(ST_SimplifyPreserveTopology(geom, getvariable('nb_simplify_m')),
                      'EPSG:7131', 'EPSG:4326', always_xy := true),
         0.000001)) AS geojson4326
FROM nb7131
ORDER BY nhood;

CREATE OR REPLACE TABLE overture_contrib AS
SELECT d AS dataset, count(*)::INTEGER AS n
FROM (SELECT unnest(datasets) AS d FROM buildings)
GROUP BY d
ORDER BY d;
