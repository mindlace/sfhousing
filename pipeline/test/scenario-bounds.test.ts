// Review Focus 4 (codec bounds, pipeline side): a yield above 65,535 is clamped and counted, and
// any other integer column that does not fit its T11 width fails loudly, never wrapping silently
// in a typed array.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FILL_LEVELS } from '../../src/lib/data/scenario-codec';
import type { Duck } from '../lib/duck';
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

const run = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-scenario-bounds-'));
  const out = await writeScenario({
    db,
    outDir: join(dir, 'out'),
    derivedDir: join(dir, 'derived'),
    datasetVersion: 'fixture-0',
    records: await readParcelRecords(db),
    capDay: CAP_DAY,
    report: new Report()
  });
  return { ...out, file: join(dir, 'out', 'scenarios/fzp/parcels.bin') };
};

beforeAll(async () => {
  db = await miniDuck();
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

  it('fails loudly when roll stories do not fit the u8 column', async () => {
    // Live 2025 roll rows carry number_of_stories up to 999 (DataSF wv5m-vpq2, 2026-10-16).
    await db.run(`UPDATE src_roll SET number_of_stories = 999 WHERE parcel_number = '3512001'`);
    await expect(run()).rejects.toThrow(
      /parcel 3512001 existingStories = 999 does not fit 0\.\.255/
    );
  });
});
