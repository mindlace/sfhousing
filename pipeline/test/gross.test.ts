import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clampGross,
  encodeGrossPayload,
  grossAt,
  grossTableOf,
  type GrossTable
} from '../../src/lib/data/gross-table';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { scenarioRecordOf, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { GROSS_BIN, PARCELS_BIN } from '../lib/scenario-files';
import { checkV36 } from '../steps/check-gross';
import { readGrossBin, writeGross } from '../steps/gross';
import { readParcelsBin } from '../steps/scenario';

const E2E = 'e2e/fixtures/data/fixture-0';

/** A temp copy of fixture-0's inputs to the gross step. */
function inputs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-gross-'));
  cpSync(join(E2E, 'manifest.json'), join(dir, 'manifest.json'));
  cpSync(join(E2E, 'parcels'), join(dir, 'parcels'), { recursive: true });
  mkdirSync(join(dir, 'scenarios/fzp'), { recursive: true });
  cpSync(join(E2E, PARCELS_BIN), join(dir, PARCELS_BIN));
  return dir;
}

function writeTable(dir: string, t: GrossTable): void {
  writeFileSync(join(dir, GROSS_BIN), deflateRawSync(encodeGrossPayload(t), { level: 9 }));
}

describe('gross step and V36', () => {
  let dirA: string;
  let dirB: string;
  let countsA: Record<string, number>;
  let countsB: Record<string, number>;
  let p: ScenarioParcels;
  let records: Map<ParcelId, ParcelRecord>;
  let m: Manifest;
  let withGross: Manifest;
  let noGross: Manifest;

  beforeAll(async () => {
    dirA = inputs();
    dirB = inputs();
    m = parseManifest(JSON.parse(readFileSync(join(dirA, 'manifest.json'), 'utf8')));
    p = readParcelsBin(join(dirA, PARCELS_BIN));
    countsA = (await writeGross({ outDir: dirA, datasetVersion: m.datasetVersion, workers: 0 }))
      .counts;
    countsB = (await writeGross({ outDir: dirB, datasetVersion: m.datasetVersion, workers: 2 }))
      .counts;
    records = new Map();
    for (const f of readdirSync(join(dirA, 'parcels'))) {
      for (const r of decodeParcelChunk(readFileSync(join(dirA, 'parcels', f), 'utf8'))) {
        records.set(r.id, r);
      }
    }
    const base = `/data/${m.datasetVersion}`;
    const { gross: _gross, ...fzp } = m.scenarios!.fzp;
    noGross = parseManifest({ ...m, scenarios: { ...m.scenarios!, fzp } });
    withGross = parseManifest({
      ...m,
      scenarios: { ...m.scenarios!, fzp: { ...m.scenarios!.fzp, gross: `${base}/${GROSS_BIN}` } }
    });
  }, 300_000);

  it('writeGross in-thread and with 2 workers writes the same table', () => {
    const a = readGrossBin(join(dirA, GROSS_BIN));
    const b = readGrossBin(join(dirB, GROSS_BIN));
    expect(a).toEqual(b);
    expect(a.count).toBe(p.count);
    expect(countsA['gross.rows']).toBe(p.count);
    expect(countsA).toEqual(countsB);
    expect(countsA['gross.values']).toBe(a.values.length);
    expect(countsA['gross.values']).toBeGreaterThan(0);
  });

  it('every row of the written table matches clampGross(scenarioYield) on the decoded chunks', () => {
    const t = readGrossBin(join(dirA, GROSS_BIN));
    expect(t.datasetVersion).toBe(m.datasetVersion);
    let nonZero = 0;
    for (let i = 0; i < t.count; i++) {
      const rec = records.get(p.id[i] as ParcelId);
      const v = rec && scenarioRecordOf(p, i, rec);
      for (const s of [...Array.from({ length: 82 }, (_, k) => k), 255]) {
        const want = v ? clampGross(scenarioYield(v, s, null)) : 0;
        const got = grossAt(t, i, s);
        if (got !== want) expect.fail(`row ${i} s ${s}: ${got} ≠ ${want}`);
        if (got > 0) nonZero++;
      }
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it('checkV36 passes on the written table', () => {
    const r = checkV36(dirA, withGross, p, records, true);
    expect(r.detail).not.toMatch(/≠|fail|missing/);
    expect(r).toMatchObject({ id: 'V36', ok: true });
  });

  it('checkV36 fails naming the row when one value is changed', () => {
    const dir = inputs();
    const t = readGrossBin(join(dirA, GROSS_BIN));
    const k = t.values.length - 1;
    let row = 0;
    while (t.offset[row + 1] <= k) row++;
    const values = Uint16Array.from(t.values);
    values[k] += 1;
    writeTable(dir, { ...t, values });
    const r = checkV36(dir, withGross, p, records, true);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(`row ${row} `);
  });

  it('checkV36 fails when the row count differs from parcels.bin', () => {
    const dir = inputs();
    writeTable(dir, grossTableOf(m.datasetVersion, []));
    const r = checkV36(dir, withGross, p, records, true);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(`0 rows, parcels.bin ${p.count}`);
  });

  it('checkV36 fails when the manifest has scenarios.fzp but no gross', () => {
    const r = checkV36(dirA, noGross, p, records, true);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('not named in the manifest');
  });
});
