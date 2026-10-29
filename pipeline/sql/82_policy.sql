-- Policy SQL stage (sim data layers, plan 1 Task 7). Run by pipeline/steps/policy-sql.ts after the
-- scenario step, on a database where runSql and runScenarioSql have run (parcels, src_parcel_attrs,
-- src_historic, src_sb79_exempt) and runPolicySql has written pol_stops. Writes pol_blklot,
-- pol_historic, pol_exempt and pol_tod, and one quality_tally row (with its quality_sample rows)
-- for each of sd.historic.no-row and sd.exempt.unmatched, which writePolicy reports.

-- Both the historic rows and the exemption rows are keyed by blklot (3tsw-4idn `apn`, the Board
-- File's Block + Lot). A blklot reaches a parcel through its active acdm-wktn row: blklot ->
-- mapblklot = parcels.id. Condo lots have one active row per unit blklot, all on one mapblklot.
CREATE OR REPLACE TABLE pol_blklot AS
SELECT DISTINCT a.blklot, a.mapblklot AS id
FROM src_parcel_attrs a
JOIN parcels p ON p.id = a.mapblklot
WHERE a.active AND a.blklot IS NOT NULL
ORDER BY a.blklot, id;

-- Historic status: one row per parcel, the most protective `ceqacodea10a11` of its rows, ranked
-- A* > A > B > C; '' when it has none (sd.historic.no-row). runPolicySql rejects any other code.
CREATE OR REPLACE TABLE pol_historic AS
WITH ranked AS (
  SELECT b.id, h.ceqacodea10a11 AS code,
         CASE h.ceqacodea10a11 WHEN 'A*' THEN 4 WHEN 'A' THEN 3 WHEN 'B' THEN 2 ELSE 1 END AS r
  FROM src_historic h
  JOIN pol_blklot b ON b.blklot = h.apn
  WHERE coalesce(h.ceqacodea10a11, '') <> ''
),
best AS (SELECT id, arg_max(code, r) AS code FROM ranked GROUP BY id)
SELECT p.id, coalesce(best.code, '') AS code
FROM parcels p
LEFT JOIN best USING (id)
ORDER BY p.id;

-- Exemptions (Ord. 082-26 §3 permanent, §4 temporary): a parcel is exempt when any of its active
-- blklots is listed. Rows that match no active parcel are dropped (sd.exempt.unmatched).
CREATE OR REPLACE TABLE pol_exempt AS
SELECT p.id,
       coalesce(bool_or(e.tbl = 'permanent'), false) AS permanent,
       coalesce(bool_or(e.tbl = 'temporary'), false) AS temporary
FROM parcels p
LEFT JOIN pol_blklot b ON b.id = p.id
LEFT JOIN src_sb79_exempt e ON e.apn = b.blklot
GROUP BY p.id
ORDER BY p.id;

-- TOD stop reach: the stop tier and distance per parcel within reach of pol_stops. Empty until the
-- SB 79 step fills it (plan 1 Task 8).
CREATE OR REPLACE TABLE pol_tod (id VARCHAR, tier INTEGER, dist_m DOUBLE);

-- ---- T14 tallies ----
INSERT INTO quality_tally
SELECT 'sd.historic.no-row', count(*) FILTER (WHERE code = ''), count(*), NULL, NULL
FROM pol_historic;
INSERT INTO quality_sample
SELECT 'sd.historic.no-row', id FROM pol_historic WHERE code = '';

INSERT INTO quality_tally
SELECT 'sd.exempt.unmatched',
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM pol_blklot b WHERE b.blklot = e.apn)),
       count(*), NULL, NULL
FROM src_sb79_exempt e;
INSERT INTO quality_sample
SELECT 'sd.exempt.unmatched', e.apn FROM src_sb79_exempt e
WHERE NOT EXISTS (SELECT 1 FROM pol_blklot b WHERE b.blklot = e.apn);
