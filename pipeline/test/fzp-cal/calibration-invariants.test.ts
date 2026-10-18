// Invariants V25-V29 (stage-calibration spec §4.10, §6): all pass on fixture-0, and each fails
// on a crafted copy.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FILL_LEVELS } from '../../../src/lib/data/scenario-codec';
import { parseCalibration } from '../../../src/lib/timelapse/model';
import { parseProjectsFile } from '../../../src/lib/timelapse/projects';
import type { Calibration, ProjectHistoriesFile } from '../../../src/lib/timelapse/types';
import { FIXTURE_PROFILE } from '../../config';
import { openDuck } from '../../lib/duck';
import { calibrate, type CalInput } from '../../lib/fzp-cal/calibrate';
import { FIXTURE_CAL } from '../../lib/fzp-cal/config';
import { checkV25, checkV26, checkV27 } from '../../lib/fzp-cal/invariants';
import { duckPanelSource } from '../../lib/fzp-cal/panel';
import { which } from '../../lib/exec';
import { CALIBRATION_JSON, readPermits, sameRuns } from '../../steps/calibration';
import { checkDataset, type InvariantResult } from '../../steps/check';
import { fixture } from '../../steps/fixture';
import { HISTORIES_JSON, PERMITS_PARQUET, PROJECTS_JSON } from '../../steps/projects';
import { PARCELS_BIN, readParcelsBin } from '../../steps/scenario';

const REPO = join(import.meta.dirname, '../../..');
const skipTiles = !(await which('tippecanoe'));
const ids = ['V25', 'V26', 'V27', 'V28', 'V29'];

describe('calibration invariants on fixture-0', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'sfh-calinv-out-'));
  const derivedRoot = mkdtempSync(join(tmpdir(), 'sfh-calinv-derived-'));
  let counts: Record<string, number>;
  let invariants: InvariantResult[];
  let json: string;
  beforeAll(async () => {
    expect(await fixture({ outDir, skipTiles, derivedRoot })).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8'));
    counts = report.counts;
    invariants = report.invariants;
    json = readFileSync(join(outDir, CALIBRATION_JSON), 'utf8');
  }, 120_000);

  const copy = () => {
    const d = mkdtempSync(join(tmpdir(), 'sfh-calinv-m-'));
    cpSync(outDir, d, { recursive: true });
    return d;
  };
  const editCal = (dir: string, f: (c: Calibration) => void) => {
    const c = JSON.parse(json) as Calibration;
    f(c);
    writeFileSync(join(dir, CALIBRATION_JSON), JSON.stringify(c));
  };
  /** `checkDataset` on `dir` with the measured extras, as the CLI re-feeds them. */
  const run = async (dir: string) =>
    checkDataset(dir, FIXTURE_PROFILE, {
      counts,
      reencodeIdentical: true,
      skipTiles: true,
      stableDetail: true,
      asOf: counts['projects.asOf'],
      projectChecks: invariants.filter((r) => ['V21', 'V22', 'V23', 'V24'].includes(r.id)),
      calibrationChecks: invariants.filter((r) => ['V28', 'V29'].includes(r.id))
    });
  const fails = async (dir: string) =>
    (await run(dir)).filter((r) => !r.ok && ids.includes(r.id)).map((r) => r.id);

  it('V25-V29 all hold in the fixture build report', () => {
    const rows = invariants.filter((r) => ids.includes(r.id));
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(rows.find((r) => r.id === 'V28')!.detail).toMatch(/fixture/);
  });

  it('V25-V29 hold when the files are re-checked, in order and before V30', async () => {
    const r = await run(outDir);
    expect(r.filter((x) => ids.includes(x.id)).filter((x) => !x.ok)).toEqual([]);
    const order = r.map((x) => x.id);
    expect(order.indexOf('V24')).toBeLessThan(order.indexOf('V25'));
    expect(order.indexOf('V29')).toBeLessThan(order.indexOf('V30'));
  });

  it('V28 and V29 fail as "not measured" when the step results are not given', async () => {
    const r = await checkDataset(outDir, FIXTURE_PROFILE, {
      counts,
      skipTiles: true,
      stableDetail: true,
      asOf: counts['projects.asOf']
    });
    for (const id of ['V28', 'V29']) {
      expect(r.find((x) => x.id === id)).toMatchObject({ ok: false, detail: 'not measured' });
    }
  });

  it('V25-V27 fail when calibration.json is missing', async () => {
    const missing = mkdtempSync(join(tmpdir(), 'sfh-calinv-none-'));
    const r = await checkDataset(missing, FIXTURE_PROFILE, { counts, stableDetail: true });
    for (const id of ['V25', 'V26', 'V27']) {
      expect(r.find((x) => x.id === id)).toMatchObject({
        ok: false,
        detail: 'scenarios/fzp/calibration.json missing'
      });
    }
  });

  it('V25 fails on a probability sum above 1', async () => {
    const d = copy();
    editCal(d, (c) => {
      c.size.byEnvelope[0].probs[0] += 0.5;
    });
    const r = (await run(d)).find((x) => x.id === 'V25')!;
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/does not parse/);
  });

  it('V25 fails on fill levels that parse but differ from FILL_LEVELS', async () => {
    const d = copy();
    editCal(d, (c) => {
      c.size.fillLevels = [0.5, 1];
      for (const e of c.size.byEnvelope) e.probs = [0.4, 0.6];
    });
    expect(() =>
      parseCalibration(JSON.parse(readFileSync(join(d, CALIBRATION_JSON), 'utf8')))
    ).not.toThrow();
    const r = (await run(d)).find((x) => x.id === 'V25')!;
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/fillLevels \[0.5, 1\] differ from FILL_LEVELS/);
  });

  it('V25 fails when asOf differs from projects.json', async () => {
    const d = copy();
    editCal(d, (c) => {
      c.asOf += 1;
    });
    const r = (await run(d)).find((x) => x.id === 'V25')!;
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/asOf \d+ differs from projects.json asOf/);
  });

  it('V25 fails on a 300 KB file', async () => {
    const d = copy();
    writeFileSync(join(d, CALIBRATION_JSON), json + ' '.repeat(300_000));
    const r = (await run(d)).find((x) => x.id === 'V25')!;
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/over 262144/);
  });

  it('checkV25 compares asOf with the histories day when given', () => {
    const asOf = (JSON.parse(json) as Calibration).asOf;
    expect(checkV25(json, json.length, FILL_LEVELS, asOf, asOf)).toEqual([]);
    expect(checkV25(json, json.length, FILL_LEVELS, asOf, asOf + 1)).toHaveLength(1);
  });

  it('V26 fails when permitOnly.construction is deleted', async () => {
    const d = copy();
    editCal(d, (c) => {
      delete c.transitions.permitOnly.construction;
    });
    const r = (await run(d)).find((x) => x.id === 'V26')!;
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/permitOnly\.construction: no cell/);
  });

  it('V26 fails when an in-flight project has no cell, and when a cell is rejected', () => {
    const cal = parseCalibration(JSON.parse(json));
    const projects = parseProjectsFile(
      JSON.parse(readFileSync(join(outDir, PROJECTS_JSON), 'utf8'))
    ).projects;
    expect(projects.length).toBeGreaterThan(0);
    expect(checkV26(cal, projects)).toEqual([]);
    expect(checkV26(cal, [{ pathway: 'permitOnly', stage: 'filed' }])).toEqual([
      'in-flight permitOnly.filed: no cell'
    ]);
    const bad = structuredClone(cal);
    const t = bad.transitions.streamlined.entitled!;
    t.tail = { advance: 0, exit: {} };
    expect(checkV26(bad, projects)).toEqual([
      'streamlined.entitled: rejected, tail rho = 0 is not positive'
    ]);
    const full = structuredClone(cal);
    const u = full.transitions.discretionary.filed!;
    u.advance = u.advance.map(() => 1);
    expect(checkV26(full, projects)[0]).toMatch(/^discretionary\.filed: rejected, C\(K\)/);
  });

  it('V27 passes on calibration-small.json', () => {
    const small = parseCalibration(
      JSON.parse(
        readFileSync(join(REPO, 'src/lib/timelapse/fixtures/calibration-small.json'), 'utf8')
      )
    );
    expect(checkV27(small, FIXTURE_CAL.v27N, FIXTURE_CAL.v27Tol)).toEqual([]);
  });

  it('checkV27 reports a cell made non-monotone (no parse)', () => {
    const cal = JSON.parse(json) as Calibration;
    expect(checkV27(cal, FIXTURE_CAL.v27N, FIXTURE_CAL.v27Tol)).toEqual([]);
    cal.transitions.discretionary.permitFiled!.advance[8] = 0.1;
    const problems = checkV27(cal, FIXTURE_CAL.v27N, FIXTURE_CAL.v27Tol);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^discretionary\.permitFiled: /);
  });

  it('V27 is deterministic: same calibration, same verdicts', () => {
    const cal = JSON.parse(json) as Calibration;
    cal.transitions.discretionary.permitFiled!.advance[8] = 0.1;
    expect(checkV27(cal, 20_000, 0.005)).toEqual(checkV27(cal, 20_000, 0.005));
  });

  it('V29: sameRuns is [] for two fixture runs and names json when one is altered', async () => {
    const derived = join(derivedRoot, 'fixture-0');
    const projects = parseProjectsFile(
      JSON.parse(readFileSync(join(outDir, PROJECTS_JSON), 'utf8'))
    );
    const histories = JSON.parse(
      readFileSync(join(derived, HISTORIES_JSON), 'utf8')
    ) as ProjectHistoriesFile;
    const db = await openDuck();
    try {
      await db.run(
        `CREATE TABLE scenario_panel AS SELECT * FROM read_parquet('${join(derived, 'parcel-panel.parquet')}')`
      );
      const input: CalInput = {
        asOf: projects.asOf,
        histories: histories.histories,
        permits: await readPermits(db, join(derived, PERMITS_PARQUET)),
        panel: await duckPanelSource(db),
        parcels: readParcelsBin(join(outDir, PARCELS_BIN)),
        inFlight: projects.projects,
        fillLevels: FILL_LEVELS,
        datasetVersion: 'fixture-0'
      };
      const a = await calibrate(input, FIXTURE_CAL);
      const b = await calibrate(input, FIXTURE_CAL);
      expect(a.json).toBe(json);
      expect(sameRuns(a, b)).toEqual([]);
      expect(sameRuns(a, { ...b, json: b.json.replace('"schema":1', '"schema":2') })).toEqual([
        'json'
      ]);
      expect(sameRuns(a, { ...b, counts: { ...b.counts, extra: 1 } })).toEqual(['counts']);
    } finally {
      db.close();
    }
  }, 120_000);

  it('a clean copy passes every calibration invariant', async () => {
    expect(await fails(copy())).toEqual([]);
  });
});
