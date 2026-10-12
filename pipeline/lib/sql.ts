import path from 'node:path';
import { config } from '../config';
import { runSqlFile, type Duck } from './duck';

export const SQL_FILES = [
  '10_parcels.sql',
  '20_landuse.sql',
  '30_buildings.sql',
  '40_heights.sql',
  '50_clip.sql',
  '60_attributes.sql',
  '70_export.sql'
];

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

/** Reset report_counts, then run the SQL files in order, up to and including `upTo`. */
export async function runSql(db: Duck, upTo?: string): Promise<void> {
  return runSqlRange(db, { from: SQL_FILES[0], to: upTo ?? SQL_FILES.at(-1)!, resetCounts: true });
}

export async function runSqlRange(
  db: Duck,
  range: { from: string; to: string; resetCounts: boolean }
): Promise<void> {
  // 30_buildings_datasf.sql (spec §4.6 fallback) is only needed after a V5 failure: not built in M1.
  if (config.renderSource === 'datasf')
    throw new Error("renderSource 'datasf' fallback not implemented");
  const first = SQL_FILES.indexOf(range.from),
    last = SQL_FILES.indexOf(range.to);
  if (first < 0 || last < first) throw new Error(`invalid SQL range: ${range.from}–${range.to}`);
  if (range.resetCounts)
    await db.run('CREATE OR REPLACE TABLE report_counts(key VARCHAR, value DOUBLE)');
  for (const f of SQL_FILES.slice(first, last + 1)) {
    await runSqlFile(db, path.join(SQL_DIR, f));
  }
}
