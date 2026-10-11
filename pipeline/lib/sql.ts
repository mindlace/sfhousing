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
  // 30_buildings_datasf.sql (spec §4.6 fallback) is only needed after a V5 failure: not built in M1.
  if (config.renderSource === 'datasf')
    throw new Error("renderSource 'datasf' fallback not implemented");
  const last = upTo === undefined ? SQL_FILES.length - 1 : SQL_FILES.indexOf(upTo);
  if (last < 0) throw new Error(`unknown SQL file: ${upTo}`);
  await db.run('CREATE OR REPLACE TABLE report_counts(key VARCHAR, value DOUBLE)');
  for (const f of SQL_FILES.slice(0, last + 1)) {
    await runSqlFile(db, path.join(SQL_DIR, f));
  }
}
