// The calibration build step on fixture-0 (stage-calibration spec §4.3, §4.4a, §4.10).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCalibration } from '../../../src/lib/timelapse/model';
import { openDuck } from '../../lib/duck';
import { FIXTURE_CAL } from '../../lib/fzp-cal/config';
import { CalibrationError, SC_RULE_IDS } from '../../lib/fzp-cal/types';
import {
  CALIBRATION_JSON,
  CALIBRATION_REPORT_MD,
  PERMIT_ROW_COLUMNS,
  writeCalibration
} from '../../steps/calibration';
import { PARCELS_BIN } from '../../lib/scenario-files';
import { fixture } from '../../steps/fixture';
import { PERMITS_PARQUET, PROJECTS_JSON } from '../../steps/projects';

const REPO = join(import.meta.dirname, '../../..');

describe('calibration step on fixture-0', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'sfh-cal-out-'));
  const derivedRoot = mkdtempSync(join(tmpdir(), 'sfh-cal-derived-'));
  let code: number;
  let counts: Record<string, number>;
  beforeAll(async () => {
    code = await fixture({ outDir, skipTiles: true, derivedRoot });
    counts = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).counts;
  });

  it('writes calibration.json, which parses, and the report into the derived cache', () => {
    expect(code).toBe(0);
    const json = readFileSync(join(outDir, CALIBRATION_JSON), 'utf8');
    const cal = parseCalibration(JSON.parse(json));
    expect(cal.schema).toBe(1);
    expect(counts['calibration.bytes']).toBe(Buffer.byteLength(json));
    expect(existsSync(join(derivedRoot, 'fixture-0', CALIBRATION_REPORT_MD))).toBe(true);
    expect(existsSync(join(outDir, CALIBRATION_REPORT_MD))).toBe(false);
  });

  it('records quality.<id>.fired and .of for every sc.* rule and the method counts', () => {
    for (const id of SC_RULE_IDS) {
      expect(counts, id).toHaveProperty(`quality.${id}.fired`);
      expect(counts, id).toHaveProperty(`quality.${id}.of`);
    }
    for (const k of [
      'calibration.method.permitOnlyPre2015',
      'calibration.method.ppaPooled',
      'calibration.method.sizeOverEnvelope',
      'calibration.window.preRoll',
      'calibration.histories',
      'calibration.qualifying',
      'calibration.panel.events',
      'calibration.purge.windows'
    ]) {
      expect(counts, k).toHaveProperty(k);
    }
    expect(
      Object.keys(counts).filter((k) => /^calibration\.(adjust|purge\.censored)/.test(k))
    ).toEqual([]);
  });

  it('PermitRow matches the permits.parquet schema', async () => {
    const db = await openDuck();
    try {
      const file = join(derivedRoot, 'fixture-0', PERMITS_PARQUET);
      const cols = await db.all<{ column_name: string; column_type: string }>(
        `DESCRIBE SELECT * FROM read_parquet('${file}')`
      );
      expect(cols.map((c) => c.column_name)).toEqual([...PERMIT_ROW_COLUMNS]);
      expect(Object.fromEntries(cols.map((c) => [c.column_name, c.column_type]))).toEqual({
        permit_number: 'VARCHAR',
        project_id: 'VARCHAR',
        prj_record_id: 'VARCHAR',
        dva_record_id: 'VARCHAR',
        prx_case_no: 'VARCHAR',
        da: 'VARCHAR',
        parcel_ids: 'VARCHAR[]',
        proposed_units: 'INTEGER',
        site_permit: 'BOOLEAN',
        status: 'VARCHAR',
        live: 'BOOLEAN',
        superseded: 'BOOLEAN',
        filed_day: 'INTEGER',
        issued_day: 'INTEGER',
        construction_day: 'INTEGER',
        complete_day: 'INTEGER',
        status_day: 'INTEGER'
      });
    } finally {
      db.close();
    }
  });

  it('writes quality.* keys only through recordQuality (no string literal)', () => {
    const files = [
      join(REPO, 'pipeline/steps/calibration.ts'),
      ...readdirSync(join(REPO, 'pipeline/lib/fzp-cal'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(REPO, 'pipeline/lib/fzp-cal', f))
    ];
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"`]quality\./);
    }
  });

  it('an asOf mismatch is a CalibrationError, before anything is written', async () => {
    // A temp copy of the inputs: the committed fixture tree is never an output directory.
    const e2e = join(REPO, 'e2e/fixtures/data/fixture-0');
    const tmp = mkdtempSync(join(tmpdir(), 'sfh-cal-asof-out-'));
    for (const f of [PROJECTS_JSON, PARCELS_BIN]) {
      mkdirSync(dirname(join(tmp, f)), { recursive: true });
      copyFileSync(join(e2e, f), join(tmp, f));
    }
    const derivedDir = mkdtempSync(join(tmpdir(), 'sfh-cal-asof-'));
    const asOf = (JSON.parse(readFileSync(join(tmp, PROJECTS_JSON), 'utf8')) as { asOf: number })
      .asOf;
    const db = await openDuck();
    try {
      await expect(
        writeCalibration({
          db,
          outDir: tmp,
          derivedDir,
          datasetVersion: 'fixture-0',
          asOf,
          histories: { schema: 1, asOf: asOf - 1, histories: [] },
          cal: FIXTURE_CAL,
          counts: {}
        })
      ).rejects.toThrow(CalibrationError);
    } finally {
      db.close();
    }
    expect(existsSync(join(tmp, CALIBRATION_JSON))).toBe(false);
    expect(readdirSync(derivedDir)).toEqual([]);
  });
});
