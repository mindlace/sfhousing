// Policy SQL stage (sim data layers): writes pol_stops and runs 82_policy.sql, which writes
// pol_blklot, pol_historic, pol_exempt and pol_tod and tallies the policy T14 rules. Not part of
// SQL_FILES / runSql: the policy step (writePolicy) calls it after the scenario step.
import path from 'node:path';
import { HISTORIC_CODES } from '../../src/lib/data/policy-codec';
import { createTableFromRows, runSqlFile, type Duck } from '../lib/duck';

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

/** The T14 rules 82_policy.sql tallies; each inserts exactly one quality_tally row per run. */
export const POLICY_SQL_RULES = ['sd.historic.no-row', 'sd.exempt.unmatched'] as const;

/**
 * Run the policy SQL on a database where runSql and runScenarioSql have run and
 * `createQualityTables` has created quality_tally / quality_sample. `stops` are the SB 79 TOD stops
 * (`tier` is the SB 79 tier), written to pol_stops. Idempotent on one database: a re-run replaces
 * this stage's tables and tallies. Throws on a historic code outside HISTORIC_CODES.
 */
export async function runPolicySql(
  db: Duck,
  stops: { id: string; tier: 1 | 2; lng: number; lat: number }[]
): Promise<void> {
  const known = HISTORIC_CODES.filter((c) => c !== '');
  const bad = await db.all<{ code: string }>(
    `SELECT DISTINCT ceqacodea10a11 AS code FROM src_historic
     WHERE coalesce(ceqacodea10a11, '') <> ''
       AND ceqacodea10a11 NOT IN (${known.map((c) => `'${c}'`).join(', ')})
     ORDER BY code`
  );
  if (bad.length > 0)
    throw new Error(`policy: unknown historic codes ${bad.map((r) => r.code).join(', ')}`);
  const ruleList = POLICY_SQL_RULES.map((id) => `'${id}'`).join(', ');
  await db.run(`DELETE FROM quality_tally WHERE rule_id IN (${ruleList})`);
  await db.run(`DELETE FROM quality_sample WHERE rule_id IN (${ruleList})`);
  await createTableFromRows(
    db,
    'pol_stops',
    [
      ['id', 'VARCHAR'],
      ['tier', 'INTEGER'],
      ['lng', 'DOUBLE'],
      ['lat', 'DOUBLE']
    ],
    stops.map((s) => [s.id, s.tier, s.lng, s.lat])
  );
  await runSqlFile(db, path.join(SQL_DIR, '82_policy.sql'));
}
