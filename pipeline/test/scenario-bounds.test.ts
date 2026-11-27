// Review Focus 4 (codec bounds, pipeline side): an integer column that does not fit its T11 width
// fails loudly, never wrapping silently in a typed array.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import type { Duck } from '../lib/duck';
import { createQualityTables } from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { readParcelRecords } from '../steps/chunks';
import { writeScenario } from '../steps/scenario';
import { miniDuck } from './helpers';

const CAP_DAY = Date.UTC(2026, 9, 10) / 86400000;
let db: Duck;

/** writeScenario on the unmutated mini DB; `edit` changes only the JS records it is given. */
const run = async (edit: (rec: ParcelRecord) => ParcelRecord = (r) => r) => {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-scenario-bounds-'));
  const out = await writeScenario({
    db,
    outDir: join(dir, 'out'),
    derivedDir: join(dir, 'derived'),
    datasetVersion: 'fixture-0',
    records: (await readParcelRecords(db)).map(({ rec, cellId }) => ({ rec: edit(rec), cellId })),
    capDay: CAP_DAY,
    report: new Report(),
    buildCounts: {}
  });
  return out;
};

beforeAll(async () => {
  db = await miniDuck();
  await createQualityTables(db);
  await runSql(db);
});

describe('writeScenario bounds', () => {
  it('fails loudly when existing stories do not fit the u8 column', async () => {
    // Lot 9 has no roll row, so its stories come from the height: round(1000 / 3.1) = 323.
    // (Roll stories above 80 are nulled by sd.roll.stories-max.) The DB is not mutated.
    await expect(
      run((r) => (r.id === '3512009' ? { ...r, existingHeightM: 1000 } : r))
    ).rejects.toThrow(/parcel 3512009 existingStories = 323 does not fit 0\.\.255/);
  });
});
