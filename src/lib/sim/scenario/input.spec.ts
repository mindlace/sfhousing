import { describe, expect, it } from 'vitest';
import { parseManifest } from '$lib/data/manifest';
import {
  FILL_LEVELS,
  featureValue,
  fillStories,
  readScenarioParcels,
  scenarioRecordOf,
  type ScenarioParcels
} from '$lib/data/scenario-codec';
import { capScenarioYield, scenarioYield } from '$lib/data/scenario-yield';
import { assembleSite } from '$lib/generator/assemble';
import { checkManifestShape } from '$lib/sim/manifest-shape';
import { exp, log } from '$lib/timelapse/math';
import { MONTH_DAYS } from '$lib/timelapse/time';
import { initiationHazard, parseCalibration } from '$lib/timelapse/model';
import { ProjectsFormatError, parseProjectsFile, type ProjectsFile } from '$lib/timelapse/projects';
import { PATHWAYS, type Calibration, type FeatureId } from '$lib/timelapse/types';
import { miniBin } from './fixtures/mini-bin';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import {
  MINI_CAPPED_ID,
  MINI_CELLS,
  MINI_CROSS_CELL_PAIR,
  MINI_HOSTABLE_NOT_BASE_ID,
  MINI_INELIGIBLE_ID,
  MINI_LP_ID,
  MINI_NONE_WITH_UNITS_ID,
  MINI_NO_ENVELOPE_ID,
  MINI_NO_GAIN_ID,
  MINI_SAME_CELL_PAIR,
  MINI_SCENARIO_URLS,
  MINI_VERSION,
  miniCity
} from './fixtures/mini-parcels';
import {
  MINI_ABSENT_PARCEL_IDS,
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_INVALID_INDEX,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import { ScenarioInputError, buildSimInput, lastInitiationMonth, precomputeOf } from './input';
import { P, draw, simEntity } from './rng';

const F = FILL_LEVELS.length;
const NO_CAP = 0xffff;
const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniProjects = (): ProjectsFile => parseProjectsFile(miniProjectsJson(), { onInvalid() {} });
const miniFiles = () => ({
  parcels: miniCity().parcels,
  projects: miniProjects(),
  calibration: miniCalibration()
});
const row = (p: ScenarioParcels, id: string) => p.index.get(id)!;
const yieldsOf = (p: ScenarioParcels, i: number) => Array.from(p.yield.subarray(i * F, i * F + F));

describe('mini city fixture', () => {
  it('parcels.bin decodes to the 60 mini rows, column for column', async () => {
    const decoded = await readScenarioParcels(miniBin());
    const { parcels } = miniCity();
    expect(decoded.count).toBe(60);
    expect(decoded.id).toEqual(parcels.id);
    expect(decoded).toEqual(parcels);
  });

  it('has 15 rows in each of 4 cells, sorted by (cellId, id), matching the manifest', () => {
    const { parcels, manifest, chunks, records } = miniCity();
    expect(parcels.cells).toEqual(
      MINI_CELLS.map((cellId, c) => ({ cellId, start: 15 * c, count: 15 }))
    );
    for (let i = 1; i < parcels.count; i++) {
      const a = parcels.cells[parcels.cell[i - 1]].cellId;
      const b = parcels.cells[parcels.cell[i]].cellId;
      expect(a < b || (a === b && parcels.id[i - 1] < parcels.id[i])).toBe(true);
    }
    expect(manifest.chunks.map((c) => c.cellId)).toEqual([...MINI_CELLS]);
    expect(manifest.chunks.map((c) => c.parcelCount)).toEqual([15, 15, 15, 15]);
    expect(checkManifestShape(manifest)).toBeNull();
    expect(parseManifest(structuredClone(manifest))).toEqual(manifest);
    expect(manifest.datasetVersion).toBe(MINI_VERSION);
    expect(manifest.scenarios?.fzp).toEqual(MINI_SCENARIO_URLS);
    expect(Object.keys(chunks)).toEqual(manifest.chunks.map((c) => c.url));
    expect([...records.keys()].sort()).toEqual([...parcels.id].sort());
    for (const c of manifest.chunks) {
      const { id } = chunks[c.url] as { id: string[] };
      const cell = parcels.cells.find((x) => x.cellId === c.cellId)!;
      expect(id).toEqual(parcels.id.slice(cell.start, cell.start + cell.count));
    }
    for (const id of ['0026T001A', '2999A019', '3512008']) expect(parcels.index.has(id)).toBe(true);
  });

  it('mixes the parcel cases later tests rely on', () => {
    const { parcels: p, records } = miniCity();
    const at = (id: string) => row(p, id);
    expect(p.localProgram.includes(0) && p.localProgram.includes(1)).toBe(true);
    expect(p.localProgram[at(MINI_LP_ID)]).toBe(1);
    // hostable vs hostableBase
    expect(p.hostable[at(MINI_HOSTABLE_NOT_BASE_ID)]).toBe(1);
    expect(p.hostableBase[at(MINI_HOSTABLE_NOT_BASE_ID)]).toBe(0);
    // a density-capped parcel and an uncapped one
    const capped = at(MINI_CAPPED_ID);
    expect(p.baseCap[capped]).toBe(3);
    expect(p.yield[capped * F + F - 1]).toBe(3);
    expect(p.baseCap[at(MINI_LP_ID)]).toBe(NO_CAP);
    // hostable, yet no level gains a home
    const noGain = at(MINI_NO_GAIN_ID);
    expect(p.hostable[noGain]).toBe(1);
    expect(p.yield[noGain * F + F - 1]).toBeLessThanOrEqual(p.existingUnits[noGain]);
    // not hostable: no envelope, ineligible
    expect(p.hostable[at(MINI_NO_ENVELOPE_ID)]).toBe(0);
    expect(p.envelopeStories[at(MINI_NO_ENVELOPE_ID)]).toBe(0);
    expect(p.hostable[at(MINI_INELIGIBLE_ID)]).toBe(0);
    expect(p.eligible[at(MINI_INELIGIBLE_ID)]).toBe(0);
    // scenario-eligible although the chunk record is not
    expect(p.eligible[at(MINI_NONE_WITH_UNITS_ID)]).toBe(1);
    expect(records.get(MINI_NONE_WITH_UNITS_ID)!.eligible).toBe(false);
    // neighbours: one cell, two cells; each pair assembles into one site ring
    expect(p.cell[at(MINI_SAME_CELL_PAIR[0])]).toBe(p.cell[at(MINI_SAME_CELL_PAIR[1])]);
    expect(p.cell[at(MINI_CROSS_CELL_PAIR[0])]).not.toBe(p.cell[at(MINI_CROSS_CELL_PAIR[1])]);
    for (const pair of [MINI_SAME_CELL_PAIR, MINI_CROSS_CELL_PAIR]) {
      const site = assembleSite(pair.map((id) => records.get(id)!));
      expect(site?.polygon.length).toBe(1);
    }
    // more than one size bucket is in use
    expect(new Set(p.envelopeStories.filter((s, i) => p.hostable[i] === 1)).size).toBeGreaterThan(
      2
    );
  });

  it('yields and hostable flags follow the pipeline rule on the scenario record', () => {
    const { parcels: p, records } = miniCity();
    for (let i = 0; i < p.count; i++) {
      const view = scenarioRecordOf(p, i, records.get(p.id[i])!);
      const cap = p.baseCap[i] === NO_CAP ? null : p.baseCap[i];
      const gross = (s: number) => (s === 0 ? 0 : scenarioYield(view, s, null));
      const at = (s: number, c: number | null) =>
        FILL_LEVELS.map((f) =>
          s === 0 ? 0 : capScenarioYield(gross(fillStories(f, s)), c, p.existingUnits[i])
        );
      const env = p.envelopeStories[i];
      const base = p.baseStories[i];
      expect(yieldsOf(p, i)).toEqual(at(env, p.localProgram[i] ? null : cap));
      expect(Array.from(p.baseYield.subarray(i * F, i * F + F))).toEqual(at(base, cap));
      const ok = p.eligible[i] === 1;
      expect(p.hostable[i]).toBe(ok && env >= 1 && gross(env) > 0 ? 1 : 0);
      expect(p.hostableBase[i]).toBe(ok && base >= 1 && gross(base) > 0 ? 1 : 0);
    }
  });
});

describe('mini projects fixture', () => {
  it('parseProjectsFile skips only the invalid project with onInvalid, and throws without', () => {
    const json = miniProjectsJson() as { projects: { id: string }[] };
    const calls: [string, string][] = [];
    const file = parseProjectsFile(miniProjectsJson(), {
      onInvalid: (path, message) => calls.push([path, message])
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`projects[${MINI_INVALID_INDEX}].units`);
    expect(json.projects[MINI_INVALID_INDEX].id).toBe(MINI_PROJECTS.invalid);
    expect(file.projects.map((p) => p.id)).toEqual(
      json.projects.map((p) => p.id).filter((id) => id !== MINI_PROJECTS.invalid)
    );
    expect(file.asOf).toBe(MINI_AS_OF);
    expect(() => parseProjectsFile(miniProjectsJson())).toThrow(ProjectsFormatError);
  });

  it('covers the spec §6 cases on parcels of the mini city', () => {
    const { parcels } = miniCity();
    const file = miniProjects();
    const byId = new Map(file.projects.map((p) => [p.id, p]));
    const P = MINI_PROJECTS;
    for (const id of Object.values(P)) if (id !== P.invalid) expect(byId.has(id)).toBe(true);
    // every stage, a null label and null stories
    expect(new Set(file.projects.map((p) => p.stage)).size).toBe(7);
    expect(new Set(file.projects.map((p) => p.pathway))).toEqual(new Set(PATHWAYS));
    expect(file.projects.some((p) => p.label === null && p.stories === null)).toBe(true);
    // every named parcel exists, except the deliberately absent ones
    const absent = file.projects.flatMap((p) => p.parcelIds).filter((id) => !parcels.index.has(id));
    expect(new Set(absent)).toEqual(new Set(MINI_ABSENT_PARCEL_IDS));
    // masters and phases
    const e3 = byId.get(P.entitled3)!;
    expect(e3.phases?.map((ph) => ph.plannedPermitFiled === null)).toEqual([false, false, true]);
    expect(e3.phases![0].plannedPermitFiled!).toBeGreaterThan(MINI_AS_OF);
    expect(e3.phases![1].plannedPermitFiled!).toBeLessThanOrEqual(MINI_AS_OF);
    const u2 = byId.get(P.unentitled2)!;
    expect(u2.history.entitled).toBeUndefined();
    expect(u2.phases).toHaveLength(2);
    expect(byId.get(P.singlePhase)!.phases).toHaveLength(1);
    expect(byId.get(P.unphased)!.phases).toBeNull();
    expect(byId.get(P.unphased)!.multiPhase).toBe(true);
    expect(byId.get(P.scoreOnly)!.parcelIds).toEqual([]);
    // V24: phase parcels are disjoint from each other and from every other project's parcels
    const holder = new Map<string, string>();
    for (const p of file.projects) {
      if (p.phases === null) continue;
      for (const ph of p.phases)
        for (const id of ph.parcelIds) {
          expect(holder.has(id)).toBe(false);
          holder.set(id, p.id);
        }
    }
    for (const p of file.projects)
      for (const id of p.parcelIds) expect([undefined, p.id]).toContain(holder.get(id));
    // a shared parcel, and the rows carrying quality ids
    const shared = byId.get(P.sharedExisting)!;
    expect(shared.parcelIds).toEqual(byId.get(P.sharedFirst)!.parcelIds);
    expect(shared.quality).toEqual(['pr.parcels.shared-existing']);
    expect(shared.existingUnits).toBeLessThan(parcels.existingUnits[row(parcels, '3512012')]);
    expect(byId.get(P.linked)!.quality).toContain('pr.pipeline.status-date-linked');
    // multi-parcel projects in one cell and across two
    const cellOf = (id: string) => parcels.cell[row(parcels, id)];
    const [a, b] = byId.get(P.crossCell)!.parcelIds;
    expect(cellOf(a)).not.toBe(cellOf(b));
    const [c, d] = byId.get(P.filedPair)!.parcelIds;
    expect(cellOf(c)).toBe(cellOf(d));
  });
});

describe('mini calibration fixture', () => {
  it('passes parseCalibration and carries the cases the simulator tests need', () => {
    const cal = miniCalibration();
    expect(cal.asOf).toBe(MINI_AS_OF);
    const count = PATHWAYS.reduce((n, p) => n + Object.keys(cal.transitions[p]).length, 0);
    expect(count).toBe(16);
    const rev = new Map(cal.revision.at.map((a) => [a.stage, a]));
    for (const s of ['permitFiled', 'permitIssued'] as const) {
      expect(rev.get(s)!.probability).toBeGreaterThan(0);
      expect(rev.get(s)!.ratio.edges).toContain(1);
    }
    expect(cal.phaseGap.days.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cal.initiation.terms.map((t) => t.feature))).toEqual(
      new Set<FeatureId>(['potentialRatio', 'storiesGap', 'landUseClass', 'improvementShare'])
    );
    expect(cal.size.byEnvelope.length).toBeGreaterThanOrEqual(2);
    expect(cal.size.fillLevels).toEqual([...FILL_LEVELS]);
  });

  it('expects several simulated starts by 2050 on the parcels no project holds', () => {
    const input = buildSimInput(miniFiles());
    const { hazard } = precomputeOf(input);
    const held = new Set(input.projects.flatMap((p) => p.parcelIds));
    const months = (MINI_HORIZON - MINI_AS_OF) / 30.436875;
    let expected = 0;
    input.parcels.id.forEach((id, i) => {
      if (!held.has(id) && hazard[i] > 0) expected += 1 - exp(months * log(1 - hazard[i]));
    });
    expect(expected).toBeGreaterThan(5);
  });
});

describe('buildSimInput', () => {
  it('assembles the SimInput from the three files, with asOf from projects.json', () => {
    const files = miniFiles();
    const warnings: string[] = [];
    const input = buildSimInput(files, (m) => warnings.push(m));
    expect(input.parcels).toBe(files.parcels);
    expect(input.projects).toBe(files.projects.projects);
    expect(input.calibration).toBe(files.calibration);
    expect(input.asOf).toBe(files.projects.asOf);
    expect(warnings).toEqual([]);
  });

  it('rejects calibration fill levels that differ from FILL_LEVELS (A2)', () => {
    const files = miniFiles();
    files.calibration.size.fillLevels = [0.25, 0.5, 0.75, 0.9, 0.95];
    let err: unknown;
    try {
      buildSimInput(files);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ScenarioInputError);
    expect((err as ScenarioInputError).file).toBe('calibration.json');
    expect((err as ScenarioInputError).message).toMatch(/fillLevels/);
    const shorter = miniFiles();
    shorter.calibration.size.fillLevels = [0.5, 1];
    expect(() => buildSimInput(shorter)).toThrow(ScenarioInputError);
    const t11 = miniFiles();
    t11.parcels.fillLevels = [0.5, 1];
    expect(() => buildSimInput(t11)).toThrow(
      expect.objectContaining({ name: 'ScenarioInputError', file: 'parcels.bin' })
    );
  });

  it('logs one warning when calibration.asOf differs from projects.asOf', () => {
    const files = miniFiles();
    files.calibration.asOf = files.projects.asOf - 1;
    const warnings: string[] = [];
    const input = buildSimInput(files, (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/asOf/);
    expect(input.asOf).toBe(files.projects.asOf);
  });
});

describe('precomputeOf', () => {
  it('is memoised per SimInput identity', () => {
    const files = miniFiles();
    const input = buildSimInput(files);
    const pre = precomputeOf(input);
    expect(precomputeOf(input)).toBe(pre);
    const other = buildSimInput(files);
    expect(precomputeOf(other)).not.toBe(pre);
    expect(precomputeOf(other).hazard).toEqual(pre.hazard);
  });

  it('gives hazard 0 to non-hostable parcels and to parcels with no gaining size level', () => {
    const input = buildSimInput(miniFiles());
    const { parcels: p, calibration: cal } = input;
    const { hazard, log1mh, sizeCum } = precomputeOf(input);
    expect(hazard).toHaveLength(p.count);
    expect(log1mh).toHaveLength(p.count);
    expect(sizeCum).toHaveLength(p.count * F);
    let positive = 0;
    for (let i = 0; i < p.count; i++) {
      const gains = yieldsOf(p, i).some((y) => y > p.existingUnits[i]);
      if (p.hostable[i] === 0 || !gains) {
        expect(hazard[i]).toBe(0);
        if (!gains) expect(Array.from(sizeCum.subarray(i * F, i * F + F))).toEqual([0, 0, 0, 0, 0]);
      } else {
        positive++;
        const f = {} as Record<FeatureId, number>;
        for (const t of cal.initiation.terms) f[t.feature] = featureValue(p, i, t.feature, 'fzp');
        expect(hazard[i]).toBe(initiationHazard(cal.initiation, f));
      }
      expect(Object.is(log1mh[i], log(1 - hazard[i]))).toBe(true);
    }
    expect(hazard[row(p, MINI_NO_GAIN_ID)]).toBe(0);
    expect(positive).toBeGreaterThan(30);
  });

  it('renormalises the size bucket over levels that gain homes', () => {
    const input = buildSimInput(miniFiles());
    const { parcels: p, calibration: cal } = input;
    const { sizeCum } = precomputeOf(input);
    const cum = (id: string) => Array.from(sizeCum.subarray(row(p, id) * F, row(p, id) * F + F));
    // 0026T003: envelope 6 (first bucket), no existing units: every level qualifies
    expect(yieldsOf(p, row(p, '0026T003')).every((y) => y > 0)).toBe(true);
    const b0 = cal.size.byEnvelope[0].probs;
    let s = 0;
    cum('0026T003').forEach((v, k) => expect(v).toBeCloseTo((s += b0[k]), 6));
    expect(cum('0026T003')[F - 1]).toBe(1);
    // 0026T001A: 2 existing units, level 0 yields 0: renormalised over levels 1..4
    const q = b0.slice(1).reduce((a, x) => a + x, 0);
    expect(cum('0026T001A')[0]).toBe(0);
    expect(cum('0026T001A')[1]).toBeCloseTo(b0[1] / q, 6);
    expect(cum('0026T001A')[F - 1]).toBe(1);
    // 2999A014: envelope 20, past every maxStoriesUpTo but the last bucket
    const last = cal.size.byEnvelope[cal.size.byEnvelope.length - 1].probs;
    expect(cum('2999A014')[0]).toBeCloseTo(last[0], 6);
  });

  it('finds parcels by id', () => {
    const input = buildSimInput(miniFiles());
    const pre = precomputeOf(input);
    expect(pre.parcelIndexOf('2999A019')).toBe(row(input.parcels, '2999A019'));
    expect(pre.parcelIndexOf(MINI_ABSENT_PARCEL_IDS[0])).toBe(-1);
  });

  it('gives hazard 0 and one warning for a hostable parcel with a non-finite feature', () => {
    const files = miniFiles();
    const p = files.parcels;
    const i = row(p, MINI_LP_ID);
    expect(p.hostable[i]).toBe(1);
    const improvementShare = Float32Array.from(p.improvementShare);
    improvementShare[i] = NaN;
    const input = buildSimInput({ ...files, parcels: { ...p, improvementShare } });
    const warnings: string[] = [];
    const pre = precomputeOf(input, (m) => warnings.push(m));
    expect(pre.hazard[i]).toBe(0);
    expect(pre.log1mh[i]).toBe(0);
    expect(warnings).toEqual([
      'parcels.bin: hazard 0 for 1 parcel(s) with a non-finite feature; ' +
        `first: ${MINI_LP_ID} improvementShare`
    ]);
    // memoised: no second warning
    precomputeOf(input, (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
  });
});

describe('the simulated pass shortcuts (precompute)', () => {
  const MD = MONTH_DAYS;
  const H = MINI_HORIZON;

  it('lists the rows that can initiate, ascending, with their parcel entities', () => {
    const input = buildSimInput(miniFiles());
    const p = input.parcels;
    const pre = precomputeOf(input);
    const want: number[] = [];
    for (let i = 0; i < p.count; i++)
      if (p.hostable[i] === 1 && pre.hazard[i] > 0 && pre.log1mh[i] < 0) want.push(i);
    expect(Array.from(pre.candidates)).toEqual(want);
    expect(Array.from(pre.entity)).toEqual(want.map((i) => simEntity(p.id[i])));
  });

  it('lastInitiationMonth is the last month T whose earliest day is on or before the horizon', () => {
    const earliest = (asOf: number, T: number) => asOf + 1 + Math.floor((T - 1) * MD);
    for (const [asOf, horizon] of [
      [MINI_AS_OF, H],
      [MINI_AS_OF, MINI_AS_OF + 1],
      [MINI_AS_OF, MINI_AS_OF + 31],
      [MINI_AS_OF, MINI_AS_OF + 32],
      [0, 10_000],
      [100, 100 + 30],
      [100, 100 + 31]
    ]) {
      const T = lastInitiationMonth(asOf, horizon);
      expect(T).toBeGreaterThanOrEqual(1);
      expect(earliest(asOf, T)).toBeLessThanOrEqual(horizon);
      expect(earliest(asOf, T + 1)).toBeGreaterThan(horizon);
    }
    expect(lastInitiationMonth(MINI_AS_OF, MINI_AS_OF)).toBe(0);
  });

  it('skipAbove: every first draw above the bound initiates after the horizon', () => {
    const input = buildSimInput(miniFiles());
    const pre = precomputeOf(input);
    const bound = pre.skipAbove(H);
    expect(pre.skipAbove(H)).toBe(bound); // memoised per horizon
    // the exact path (§4.4.4 steps 1-2), as the engine evaluates it, from r = asOf, k = 0
    const day = (u: number, v: number, log1mh: number) =>
      input.asOf + 1 + Math.floor((Math.max(1, Math.ceil(log(1 - u) / log1mh)) - 1 + v) * MD);
    let bounded = 0;
    let skipped = 0;
    pre.candidates.forEach((i, c) => {
      const b = bound[c];
      const L = pre.log1mh[i];
      if (!Number.isFinite(b)) return;
      bounded++;
      // just above the bound, whatever v: after the horizon
      for (const u of [b, b * (1 + 1e-12), b + 1e-9, (b + 1) / 2, 1 - 0.5 / 4294967296]) {
        if (!(u < 1)) continue;
        for (const v of [0.5 / 4294967296, 0.5, 1 - 0.5 / 4294967296]) {
          expect(day(u, v, L)).toBeGreaterThan(H);
        }
      }
      // the bound is tight: a little below the unwidened u*, the earliest day is in time
      const uStar = 1 - exp(lastInitiationMonth(input.asOf, H) * L);
      expect(day(uStar * (1 - 1e-4), 0.5 / 4294967296, L)).toBeLessThanOrEqual(H);
      // and the real first draws: those above the bound never initiate
      for (let seed = 1; seed <= 200; seed++) {
        const u = draw(seed, pre.entity[c], 0, P.INIT, 0);
        if (!(u > b)) continue;
        skipped++;
        expect(day(u, draw(seed, pre.entity[c], 0, P.INIT_DAY, 0), L)).toBeGreaterThan(H);
      }
    });
    expect(bounded).toBeGreaterThan(20);
    expect(skipped).toBeGreaterThan(100);
  });
});
