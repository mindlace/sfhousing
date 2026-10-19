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
import { QUALITY_RULES } from '../../lib/quality';
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

  it('pins the fixture-0 sc.* counts, method counts and pre-roll count (spec §4.4a, §4.12)', () => {
    const rules: Record<string, [number, number]> = {
      // [fired, of]: the mini histories have no gap, no missing first_construction_document_date,
      // no out-of-order stage, no exit past the last stage and no purge window, by design.
      // of: project-records added mini histories BP:200406010024, BP:201112010026, BP:201409010025,
      // BP:201410010027, BP:202503010028 (M24-M28): +5 qualifying, running-max 24; BP:200406010024
      // ends before the first roll (preRoll 1) so the windowed denominators gain 4 (23); of 3
      // ended, 2 of them exits, so last-stage 7 and purge-censor 6.
      // Then M29 (PRJ:2016-000029PRJ, Ruling F1a): open at permitFiled since 2016, qualifying on its
      // permit's 2 units, so +1 to running-max (25) and the windowed denominators (24); it is
      // open (last-stage, purge-censor unchanged) and filed after 2015 (permitOnlyPre2015 stays 5).
      // Then M30 and M31 (PRJ:2018-000030PRJ, PRJ:2019-000031PRJ; Rulings L1, L2): two open
      // discretionary histories filed 2018 and 2019, qualifying on 5 and 6 units over 0 existing,
      // so +2 to running-max (27) and the windowed denominators (26); open (last-stage and
      // purge-censor unchanged) and not permit-only (permitOnlyPre2015 stays 5).
      // Then M32 and M33 (Ruling SP1; supersession is T3 only, both histories stay): open at filed
      // in 2026, qualifying on 10 and 12 units, pathway null, so +2 again (29 and 28); open and
      // not permit-only (last-stage, purge-censor and permitOnlyPre2015 unchanged).
      // Then M34-M38 (Rulings IL1, SE1): five Planning-record histories filed 2018-2022 (4, 10, 8,
      // 10 and 6 units), so +5 again (34 and 33); M34 (inferred lapse) and M36 (streamlined
      // expiry) exit at entitled, so last-stage 9 and purge-censor 8; none is permit-only.
      // Then M39 and M40 (review I2): two open discretionary histories (4 and 5 units), so +2 (36
      // and 35); open, so last-stage and purge-censor unchanged.
      'sc.stages.gap-impute': [0, 35],
      'sc.stages.no-fcd-duration': [0, 35],
      // Spec §4.4a "Fixture cases": these two must not fire on fixture-0 (of > 0).
      'sc.stages.running-max': [0, 36],
      'sc.exit.last-stage': [0, 9],
      'sc.exit.purge-censor': [0, 8],
      // Ruling R26: of = 0 because the mini histories have no revised pair to clamp.
      'sc.revision.ratio-clamp': [0, 0]
    };
    expect(Object.keys(rules).sort()).toEqual(
      QUALITY_RULES.filter((r) => r.id.startsWith('sc.'))
        .map((r) => r.id)
        .sort()
    );
    for (const [id, [fired, of]] of Object.entries(rules)) {
      expect([counts[`quality.${id}.fired`], counts[`quality.${id}.of`]], id).toEqual([fired, of]);
    }
    expect(counts['quality.sc.stages.running-max.fired']).toBe(0);
    expect(counts['quality.sc.stages.running-max.of']).toBeGreaterThan(0);
    expect(counts['quality.sc.exit.last-stage.fired']).toBe(0);
    expect(counts['quality.sc.exit.last-stage.of']).toBeGreaterThan(0);
    expect({
      permitOnlyPre2015: counts['calibration.method.permitOnlyPre2015'],
      ppaPooled: counts['calibration.method.ppaPooled'],
      sizeOverEnvelope: counts['calibration.method.sizeOverEnvelope'],
      preRoll: counts['calibration.window.preRoll']
      // The added permit-only histories filed before 2015 (0024, 0026, 0025, 0027) make 1 + 4 = 5;
      // BP:200406010024 is the pre-roll one.
    }).toEqual({ permitOnlyPre2015: 5, ppaPooled: 2, sizeOverEnvelope: 0, preRoll: 1 });
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
