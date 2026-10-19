// Review Focus 4 (codec bounds, pipeline side): a yield above 65,535 is clamped and counted, and
// any other integer column that does not fit its T11 width fails loudly, never wrapping silently
// in a typed array.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FILL_LEVELS } from '../../src/lib/data/scenario-codec';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import type { Duck } from '../lib/duck';
import { createQualityTables } from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { readParcelRecords } from '../steps/chunks';
import { readParcelsBin, writeScenario } from '../steps/scenario';
import { miniDuck } from './helpers';

/** Far past the u16 column: every generated building has 70,000 units. */
vi.mock('../../src/lib/data/scenario-yield', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/data/scenario-yield')>();
  return {
    ...real,
    scenarioYield: (_rec: unknown, stories: number, cap: number | null) =>
      stories <= 0 ? 0 : real.capScenarioYield(70000, cap, 0)
  };
});

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
  return { ...out, file: join(dir, 'out', 'scenarios/fzp/parcels.bin') };
};

beforeAll(async () => {
  db = await miniDuck();
  await createQualityTables(db);
  await runSql(db);
});

describe('writeScenario bounds', () => {
  it('clamps a yield above 65,535 to 65,535 and counts it', async () => {
    const { counts, file } = await run();
    const p = readParcelsBin(file);
    const F = FILL_LEVELS.length;
    // Lot 14 (Local Program, no cap): every fill level is clamped.
    const i = p.index.get('3512014')!;
    expect([...p.yield.subarray(i * F, i * F + F)]).toEqual([65535, 65535, 65535, 65535, 65535]);
    expect(Math.max(...p.yield)).toBe(65535);
    expect(counts['scenario.yield.clamped']).toBeGreaterThanOrEqual(F);
  });

  it('fails loudly when existing stories do not fit the u8 column', async () => {
    // Lot 9 has no roll row, so its stories come from the height: round(1000 / 3.1) = 323.
    // (Roll stories above 80 are nulled by sd.roll.stories-max.) The DB is not mutated.
    await expect(
      run((r) => (r.id === '3512009' ? { ...r, existingHeightM: 1000 } : r))
    ).rejects.toThrow(/parcel 3512009 existingStories = 323 does not fit 0\.\.255/);
  });
});
