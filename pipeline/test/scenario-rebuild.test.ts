// Reproducibility in the worker (scenario-data spec §4.7, §6, IA-8, AC 17): the stored caps and
// hostable flags of parcels.bin are rebuilt from what the worker has, the decoded file and the
// chunk record, through the codec's scenarioRecordOf, the shared candidate options and the §4.4
// caps.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { topHomesAt } from '../../src/lib/data/envelope-row';
import { scenarioRecordOf, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { fnv1a32 } from '../../src/lib/generator';
import { FTF_M } from '../../src/lib/generator/constants';
import { candidatesOf } from '../../src/lib/sim/choice/options';
import { SQL_VARS } from '../config';
import { FZP_EFFECTIVE_DAY, densityCap } from '../lib/density-caps';
import { readLock } from '../lib/lock';
import { createQualityTables } from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { asOfFromLock } from '../project-records/parse';
import { readParcelRecords } from '../steps/chunks';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { MINI, miniDuck } from './helpers';

/** T11 `baseCap` "no cap" sentinel (spec §2, §4.8). */
const NULL_CAP = 0xffff;

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

describe('scenario caps and hostable flags rebuild from parcels.bin and the chunk record (IA-8)', () => {
  it("every parcel: the caps are §4.4's and the flags the options' on scenarioRecordOf", () => {
    expect(p.count, '25 mini lots, lots 19-25 included').toBe(25);
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
      expect(fzpCap ?? NULL_CAP, `${id} fzpCap`).toBe(p.fzpCap[i]);
      const options = candidatesOf(view, fnv1a32(id));
      const gains = (stories: number) =>
        stories >= 1 && topHomesAt(options, stories, null, 0) > p.existingUnits[i];
      const e = p.eligible[i] === 1;
      expect({ h: p.hostable[i], hb: p.hostableBase[i] }, id).toEqual({
        h: e && gains(p.envelopeStories[i]) ? 1 : 0,
        hb: e && gains(p.baseStories[i]) ? 1 : 0
      });
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

  it('the storey height has one source: SQL_VARS.floors_m is the codec’s FTF_M', () => {
    // The stories fallback (81_scenario_features.sql, the no-row defaults) divides by floors_m;
    // the worker's existingHeightM multiplies by FTF_M. One value keeps the height round-trip.
    expect(SQL_VARS.floors_m).toBe(FTF_M);
    const src = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/floors_m: FTF_M\b/);
  });

  it('pipeline/steps/scenario.ts builds no scenario record of its own', () => {
    const src = readFileSync(new URL('../steps/scenario.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/function scenarioRecord\b/);
    expect(src).not.toMatch(/existingHeightM\s*:/);
    expect(src).toMatch(/scenarioRecordOf\(p, i, rows\[i\]\.rec\)/);
    // The candidates are generated on scenarioRecordFrom(rec, job), the row's own values.
    const opts = readFileSync(new URL('../steps/options.ts', import.meta.url), 'utf8');
    expect(opts).toMatch(/scenarioRecordFrom\(rec, job\)/);
  });
});
