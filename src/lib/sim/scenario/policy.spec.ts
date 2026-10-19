// The T9 policy seam (spec §6 `policy.spec.ts`, AC 17): the `baseZoning` view, common random
// numbers between an FZP run and its twin, and that calibration edits alone change outcomes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import { PATHWAYS, type Calibration, type ExitReason, type Stage } from '$lib/timelapse/types';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_AS_OF, MINI_HORIZON, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput, precomputeOf } from './input';
import { applyPolicies, baseZoning, type PolicyOp } from './policy';
import { monthsOf, planEffectOf } from './score';
import { simulateDetailed, simulateNet } from './simulate';
import type { SimInput } from './types';

const H = MINI_HORIZON;
const SEEDS_20 = Array.from({ length: 20 }, (_, i) => i + 1);

const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniFiles = () => ({
  parcels: miniCity().parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: miniCalibration()
});
const miniInput = (): SimInput => buildSimInput(miniFiles());

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('baseZoning view (§4.4.8)', () => {
  it('swaps envelope, yield, hostable and the feature variants onto the base columns', () => {
    const p = miniInput().parcels;
    const { parcels: v } = baseZoning(miniCalibration(), p);
    expect(v.envelopeStories).toBe(p.baseStories);
    expect(v.yield).toBe(p.baseYield);
    expect(v.hostable).toBe(p.hostableBase);
    expect(v.potentialRatio.fzp).toBe(p.potentialRatio.base);
    expect(v.storiesGap.fzp).toBe(p.storiesGap.base);
    expect(v.potentialRatio.base).toBe(p.potentialRatio.base);
    expect(v.storiesGap.base).toBe(p.storiesGap.base);
  });

  it('turns the Local Program off with a fresh zero column; the source is untouched', () => {
    const p = miniInput().parcels;
    expect(Array.from(p.localProgram).some((x) => x === 1)).toBe(true);
    const before = Array.from(p.localProgram);
    const { parcels: v } = baseZoning(miniCalibration(), p);
    expect(v.localProgram).not.toBe(p.localProgram);
    expect(v.localProgram.length).toBe(p.count);
    expect(Array.from(v.localProgram).every((x) => x === 0)).toBe(true);
    expect(Array.from(p.localProgram)).toEqual(before);
  });

  it('copies nothing else: every other column is the same object', () => {
    const p = miniInput().parcels;
    const { parcels: v } = baseZoning(miniCalibration(), p);
    const swapped = new Set([
      'envelopeStories',
      'yield',
      'hostable',
      'localProgram',
      'potentialRatio',
      'storiesGap'
    ]);
    for (const k of Object.keys(p) as (keyof ScenarioParcels)[]) {
      if (swapped.has(k)) continue;
      expect(v[k]).toBe(p[k]);
    }
  });

  it('returns the same calibration object, deep-equal to a pre-call clone', () => {
    const cal = miniCalibration();
    const clone = structuredClone(cal);
    const out = baseZoning(cal, miniInput().parcels);
    expect(out.cal).toBe(cal);
    expect(out.cal).toEqual(clone);
  });
});

describe('applyPolicies', () => {
  it('returns a new SimInput with its own precompute; the original is unchanged', () => {
    const inp = miniInput();
    const twin = applyPolicies([baseZoning], inp);
    expect(twin).not.toBe(inp);
    expect(twin.parcels).not.toBe(inp.parcels);
    expect(twin.projects).toBe(inp.projects);
    expect(twin.calibration).toBe(inp.calibration);
    expect(twin.asOf).toBe(inp.asOf);
    expect(inp.parcels.envelopeStories).not.toBe(inp.parcels.baseStories);
    expect(precomputeOf(twin)).not.toBe(precomputeOf(inp));
  });

  it('with no ops still returns a new object', () => {
    const inp = miniInput();
    const same = applyPolicies([], inp);
    expect(same).not.toBe(inp);
    expect(same).toEqual(inp);
  });

  it('applies ops in order, threading calibration and parcels through each', () => {
    const inp = miniInput();
    const seen: string[] = [];
    const tag =
      (name: string): PolicyOp =>
      (cal, parcels) => {
        seen.push(name);
        return { cal, parcels };
      };
    const cal2 = miniCalibration();
    const swapCal: PolicyOp = (_cal, parcels) => ({ cal: cal2, parcels });
    const out = applyPolicies([tag('a'), swapCal, baseZoning, tag('b')], inp);
    expect(seen).toEqual(['a', 'b']);
    expect(out.calibration).toBe(cal2);
    expect(out.parcels.hostable).toBe(inp.parcels.hostableBase);
  });
});

describe('common random numbers (§4.4.8)', () => {
  it('every pipeline and phase Schedule has identical entered and end in the FZP run and its twin', () => {
    const fzp = miniInput();
    const twin = applyPolicies([baseZoning], fzp);
    let phases = 0;
    let pipeline = 0;
    for (const seed of SEEDS_20) {
      const a = simulateDetailed(fzp, seed, H).schedules;
      const b = simulateDetailed(twin, seed, H).schedules;
      const pick = (ss: typeof a) =>
        ss
          .filter((s) => s.origin === 'pipeline')
          .map((s) => ({ id: s.projectId, entered: s.entered, end: s.end }));
      const pa = pick(a);
      expect(pa.length).toBeGreaterThan(0);
      expect(pick(b)).toEqual(pa);
      pipeline += pa.length;
      phases += a.filter((s) => s.phase !== null).length;
    }
    expect(pipeline).toBeGreaterThan(0);
    expect(phases).toBeGreaterThan(0);
  });

  it('with base columns equal to the FZP columns, planEffect is identically 0', () => {
    const files = miniFiles();
    const p = files.parcels;
    // a test-made copy whose base columns are the FZP ones, and no Local Program (baseZoning
    // switches it off, so the FZP side must have it off too)
    const same: ScenarioParcels = {
      ...p,
      baseStories: p.envelopeStories,
      baseYield: p.yield,
      hostableBase: p.hostable,
      localProgram: new Uint8Array(p.count),
      potentialRatio: { fzp: p.potentialRatio.fzp, base: p.potentialRatio.fzp },
      storiesGap: { fzp: p.storiesGap.fzp, base: p.storiesGap.fzp }
    };
    const fzp = buildSimInput({ ...files, parcels: same });
    const twin = applyPolicies([baseZoning], fzp);
    const months = monthsOf(MINI_AS_OF, H);
    let nonTrivial = 0;
    for (const seed of SEEDS_20) {
      const a = simulateNet(fzp, seed, H, months);
      const b = simulateNet(twin, seed, H, months);
      const pe = planEffectOf(a, b);
      expect(pe.length).toBe(months.length);
      expect(pe.every((r) => r.entitledNew === 0 && r.completedNetNew === 0)).toBe(true);
      if (a.completedNetNew[months.length - 1] > 0) nonTrivial++;
    }
    expect(nonTrivial).toBeGreaterThan(0); // the identity is not vacuous
  });

  it('with the real columns the plan does change the outcome (the 0 above is not trivial)', () => {
    const fzp = miniInput();
    const twin = applyPolicies([baseZoning], fzp);
    const months = monthsOf(MINI_AS_OF, H);
    const differs = SEEDS_20.some((seed) => {
      const pe = planEffectOf(
        simulateNet(fzp, seed, H, months),
        simulateNet(twin, seed, H, months)
      );
      return pe.some((r) => r.completedNetNew !== 0);
    });
    expect(differs).toBe(true);
  });
});

describe('calibration edits alone change outcomes (T9 seam)', () => {
  it('zeroed exit tables give no exit ends', () => {
    const base = miniInput();
    let baseExits = 0;
    for (const seed of SEEDS_20) {
      baseExits += simulateDetailed(base, seed, H).schedules.filter(
        (s) => s.end.kind === 'exit'
      ).length;
    }
    expect(baseExits).toBeGreaterThan(0); // the unedited calibration does exit

    const cal = miniCalibration();
    for (const pw of PATHWAYS) {
      for (const st of Object.keys(cal.transitions[pw]) as Exclude<Stage, 'complete'>[]) {
        const t = cal.transitions[pw][st]!;
        for (const r of Object.keys(t.exit) as ExitReason[]) t.exit[r] = t.exit[r]!.map(() => 0);
        for (const r of Object.keys(t.tail.exit) as ExitReason[]) t.tail.exit[r] = 0;
      }
    }
    const zeroed = buildSimInput({ ...miniFiles(), calibration: cal });
    let exits = 0;
    let schedules = 0;
    for (const seed of SEEDS_20) {
      const ss = simulateDetailed(zeroed, seed, H).schedules;
      schedules += ss.length;
      exits += ss.filter((s) => s.end.kind === 'exit').length;
    }
    expect(schedules).toBeGreaterThan(0);
    expect(exits).toBe(0);
  });

  it('initiation.intercept = -1000 gives no simulated projects', () => {
    const base = miniInput();
    let baseSim = 0;
    for (const seed of SEEDS_20) {
      baseSim += simulateDetailed(base, seed, H).schedules.filter(
        (s) => s.origin === 'simulated'
      ).length;
    }
    expect(baseSim).toBeGreaterThan(0); // the unedited calibration initiates

    const cal = miniCalibration();
    cal.initiation = { ...cal.initiation, intercept: -1000 };
    const quiet = buildSimInput({ ...miniFiles(), calibration: cal });
    let sim = 0;
    let pipeline = 0;
    for (const seed of SEEDS_20) {
      const ss = simulateDetailed(quiet, seed, H).schedules;
      sim += ss.filter((s) => s.origin === 'simulated').length;
      pipeline += ss.filter((s) => s.origin === 'pipeline').length;
    }
    expect(sim).toBe(0);
    expect(pipeline).toBeGreaterThan(0);
  });
});
