// Reproducibility in the worker (scenario-data spec §4.7, §6, IA-8, AC 17): the stored yields of
// parcels.bin are rebuilt from what the worker has, the decoded file and the chunk record, through
// the codec's scenarioRecordOf, the shared scenarioYield and the §4.4 caps.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import {
  FILL_LEVELS,
  fillStories,
  scenarioRecordOf,
  type ScenarioParcels
} from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { FZP_EFFECTIVE_DAY, densityCap } from '../lib/density-caps';
import { readLock } from '../lib/lock';
import { createQualityTables } from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { asOfFromLock } from '../project-records/parse';
import { readParcelRecords } from '../steps/chunks';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { MINI, miniDuck } from './helpers';

const F = FILL_LEVELS.length;
/** T11 `baseCap` "no cap" sentinel and the u16 yield ceiling (spec §2, §4.8). */
const NULL_CAP = 0xffff;
const U16_MAX = 0xffff;

let p: ScenarioParcels;
let recById: Map<string, ParcelRecord>;
let zoning: Map<string, { r4: boolean; zoning_code: string | null }>;
let capDay: number;

beforeAll(async () => {
  const db = await miniDuck();
  await createQualityTables(db);
  await runSql(db);
  const records = await readParcelRecords(db);
  recById = new Map(records.map(({ rec }) => [rec.id, rec]));
  capDay = asOfFromLock(readLock(join(MINI, 'sources.lock.json')));
  const root = mkdtempSync(join(tmpdir(), 'sfh-scenario-rebuild-'));
  await writeScenario({
    db,
    outDir: join(root, 'out'),
    derivedDir: join(root, 'derived'),
    datasetVersion: 'fixture-0',
    records,
    capDay,
    report: new Report(),
    buildCounts: {}
  });
  p = readParcelsBin(join(root, 'out', PARCELS_BIN));
  const rows = await db.all<{ id: string; r4: boolean; zoning_code: string | null }>(
    'SELECT d.id, d.r4, z.zoning_code FROM sc_district d JOIN sc_zoning z USING (id) ORDER BY d.id'
  );
  zoning = new Map(rows.map((r) => [r.id, r]));
});

describe('scenario yields rebuild from parcels.bin and the chunk record (IA-8)', () => {
  it('every parcel: yield and baseYield equal scenarioYield on scenarioRecordOf', () => {
    expect(p.count).toBe(14);
    for (let i = 0; i < p.count; i++) {
      const id = p.id[i];
      const rec = recById.get(id);
      const z = zoning.get(id);
      expect(rec, id).toBeDefined();
      expect(z, id).toBeDefined();
      const view = scenarioRecordOf(p, i, rec!);
      expect(Number.isInteger(view.existingFloorAreaM2), id).toBe(true);
      // Caps of §4.4: base = the zoning before the FZP; FZP = capDay, none under the Local Program.
      const baseCap = densityCap(z!.zoning_code, p.lotAreaM2[i], z!.r4, FZP_EFFECTIVE_DAY - 1);
      expect(baseCap ?? NULL_CAP, `${id} baseCap`).toBe(p.baseCap[i]);
      const fzpCap = p.localProgram[i]
        ? null
        : densityCap(z!.zoning_code, p.lotAreaM2[i], z!.r4, capDay);
      const at = (stories: number, k: number, cap: number | null) =>
        stories === 0
          ? 0
          : Math.min(U16_MAX, scenarioYield(view, fillStories(FILL_LEVELS[k], stories), cap));
      const want = {
        yield: FILL_LEVELS.map((_, k) => at(p.envelopeStories[i], k, fzpCap)),
        baseYield: FILL_LEVELS.map((_, k) => at(p.baseStories[i], k, baseCap))
      };
      expect(
        {
          yield: [...p.yield.subarray(i * F, i * F + F)],
          baseYield: [...p.baseYield.subarray(i * F, i * F + F)]
        },
        id
      ).toEqual(want);
    }
  });

  it('some parcel is rebuilt from values that differ from its chunk record', () => {
    // Otherwise the test above could pass with the chunk record alone.
    const differs = p.id.filter((id, i) => {
      const rec = recById.get(id)!;
      return (
        rec.existingUnits !== p.existingUnits[i] ||
        rec.existingFloorAreaM2 !== p.existingFloorAreaM2[i]
      );
    });
    expect(differs.length).toBeGreaterThan(0);
  });

  it('pipeline/steps/scenario.ts builds no scenario record of its own', () => {
    const src = readFileSync(new URL('../steps/scenario.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/function scenarioRecord\b/);
    expect(src).not.toMatch(/existingHeightM\s*:/);
    expect(src).toMatch(/scenarioRecordOf\(p, i, rec\)/);
  });
});
